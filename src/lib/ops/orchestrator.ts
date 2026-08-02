import "server-only";

import {
  FARE_ADJUSTMENT_FLAG,
  INCIDENT_ERROR_THRESHOLD,
  INCIDENT_WINDOW_SECONDS,
  RECOVERY_GREEN_TICKS,
  getIncidentRedetectCooldownSeconds,
  getMaxIncidentsPerHour,
  getOutageTtlMinutes,
} from "./config";
import {
  appendIncidentEvent,
  createIncident,
  fetchErrorCount,
  fetchErrors,
  fetchFlags,
  fetchIncidents,
  incidentKind,
  patchIncident,
  setFlag,
} from "./backend";
import { runProbes, probesHealthy } from "./probe";
import {
  agentsAvailable,
  getAgentStatus,
  launchFixer,
  launchSummarizer,
} from "./agents";
import { ensureDemoLabeled } from "./labeling";
import {
  detectionBlocks,
  prBlocks,
  postSlack,
  postSlackWithRef,
  recoveryBlocks,
  summaryBlocks,
} from "./slack";
import {
  createSlackThreadEvent,
  slackReplyOptions,
} from "./slack-thread";
import { isSessionScopedIncident, runDemoSessionsTick } from "./demo";
import type { IncidentEvent, OpsError, OpsFlag, OpsIncident, OpsSnapshot } from "./types";

function ev(kind: string, message: string, data?: Record<string, unknown>): IncidentEvent {
  return { at: new Date().toISOString(), kind, message, data };
}

// Canned summary used only when no CURSOR_API_KEY is configured (local dev),
// so the timeline + Slack flow are still demoable without launching agents.
const SIMULATED_SUMMARY =
  "*Impact:* Customers cannot search or book flights; the pricing endpoints are returning errors.\n" +
  "*Likely cause:* A fuel-surcharge lookup in the pricing path fails for every route, throwing on each request.\n" +
  "*Next step:* A small fix to the surcharge route-key lookup is being prepared.";

export async function buildSnapshot(): Promise<OpsSnapshot> {
  const [flags, probes, errors, count5xx, recent] = await Promise.all([
    fetchFlags(),
    runProbes(),
    fetchErrors(30),
    fetchErrorCount(INCIDENT_WINDOW_SECONDS),
    fetchIncidents(20),
  ]);
  return snapshotShape(flags, probes, errors, count5xx, recent);
}

function snapshotShape(
  flags: OpsFlag[],
  probes: OpsSnapshot["probes"],
  errors: OpsError[],
  count5xx: number,
  recent: OpsIncident[],
): OpsSnapshot {
  const outage = flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG);
  // The global snapshot ignores per-session ("scoped") demo incidents so they
  // never clobber the global view; those are surfaced to presenters via the
  // /api/ops/demo/status route instead.
  const globalOutage = (i: OpsIncident) =>
    incidentKind(i) === "outage" && !isSessionScopedIncident(i);
  const openOutage =
    recent.find((i) => i.status === "open" && globalOutage(i)) ?? null;
  const recentGlobal = recent.filter((i) => !isSessionScopedIncident(i));
  return {
    now: new Date().toISOString(),
    outageEnabled: outage?.enabled ?? false,
    flags,
    probes,
    errors,
    errorRate5xx: count5xx,
    incident: openOutage ?? recentGlobal[0] ?? null,
    agentsAvailable: agentsAvailable(),
  };
}

export type TickOptions = { force?: boolean };

// Detection decision for the outage path. Collapses the flag/probe/cooldown/cap
// boolean soup into one discriminant the detect block can switch on.
export type OpsTickDecision =
  | { type: "healthy" }
  | { type: "progress"; incident: OpsIncident }
  | { type: "detect"; reason: "force" | "active" | "error_threshold" }
  | { type: "suppressed"; reason: "cooldown" | "cap"; openedLastHour?: number };

function decideOutageTick(input: {
  incident: OpsIncident | null;
  force: boolean;
  outageActiveNow: boolean;
  count5xx: number;
  inCooldown: boolean;
  capReached: boolean;
  openedLastHour: number;
}): OpsTickDecision {
  if (input.incident) {
    return { type: "progress", incident: input.incident };
  }

  const signal: OpsTickDecision | null = input.force
    ? { type: "detect", reason: "force" }
    : input.outageActiveNow
      ? { type: "detect", reason: "active" }
      : input.count5xx >= INCIDENT_ERROR_THRESHOLD
        ? { type: "detect", reason: "error_threshold" }
        : null;

  if (!signal) return { type: "healthy" };

  // Cap always wins once reached.
  if (input.capReached) {
    return {
      type: "suppressed",
      reason: "cap",
      openedLastHour: input.openedLastHour,
    };
  }

  // Cooldown only suppresses residual trailing-5xx detection (error_threshold).
  // force / active outages still open.
  if (input.inCooldown && signal.reason === "error_threshold") {
    return { type: "suppressed", reason: "cooldown" };
  }

  return signal;
}

// One step of the incident state machine. Idempotent and safe to call
// frequently (Vercel cron ~60s hits it, and callers may invoke it directly).
// Returns the fresh snapshot so callers can render without a second round trip.
export async function runTick(options: TickOptions = {}): Promise<OpsSnapshot> {
  let flags = await fetchFlags();
  const probes = await runProbes();

  // Each block is wrapped so a failure (backend, Slack, or agent call) degrades
  // gracefully and can never throw out of the tick or crash /api/ops/tick.
  let count5xx = 0;
  try {
    count5xx = await fetchErrorCount(INCIDENT_WINDOW_SECONDS);
  } catch (err) {
    console.warn("[ops/tick] error count fetch failed:", errMsg(err));
  }
  try {
    flags = await runOutageTick(flags, probes, count5xx, options);
  } catch (err) {
    console.warn("[ops/tick] outage handling failed:", errMsg(err));
  }

  // Per-session scoped demo outages. Additive: no-op when there are no active
  // demo sessions. Never touches the global incident.
  try {
    await runDemoSessionsTick();
  } catch (err) {
    console.warn("[ops/tick] demo session handling failed:", errMsg(err));
  }

  let recent: OpsIncident[] = [];
  try {
    recent = await fetchIncidents(20);
  } catch (err) {
    console.warn("[ops/tick] incident read failed:", errMsg(err));
  }
  let errors: OpsError[] = [];
  try {
    errors = await fetchErrors(30);
  } catch (err) {
    console.warn("[ops/tick] error read failed:", errMsg(err));
  }
  return snapshotShape(flags, probes, errors, count5xx, recent);
}

async function runOutageTick(
  flags: OpsFlag[],
  probes: OpsSnapshot["probes"],
  count5xx: number,
  options: TickOptions,
): Promise<OpsFlag[]> {
  const healthy = probesHealthy(probes);

  // Auto-expiry safety net: if the outage flag has been on longer than the TTL,
  // flip it back off so a forgotten demo self-heals.
  const ttl = getOutageTtlMinutes();
  const outageFlag = flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG);
  let autoExpired = false;
  if (ttl > 0 && outageFlag?.enabled) {
    const ageMin = (Date.now() - new Date(outageFlag.updatedAt).getTime()) / 60000;
    if (ageMin >= ttl) {
      await setFlag(FARE_ADJUSTMENT_FLAG, false, "auto-expiry");
      flags = await fetchFlags();
      autoExpired = true;
    }
  }

  // Per-session demo incidents are filtered out so the global path never picks
  // one up, and so scoped incidents do not consume the global cooldown or
  // per-hour cap. The scoped arc runs independently in demo.ts.
  const recent = (await fetchIncidents(50)).filter(
    (i) => !isSessionScopedIncident(i),
  );
  let incident =
    recent.find((i) => i.status === "open" && incidentKind(i) === "outage") ?? null;

  if (autoExpired && incident) {
    await appendIncidentEvent(
      incident.id,
      ev("auto_expired", `Outage flag auto-expired after ${ttl} min; service restored.`),
    );
  }

  const outageEnabledNow =
    flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG)?.enabled ?? false;
  const outageActiveNow =
    outageEnabledNow || (!healthy && !probesAreOnlyTimeouts(probes));

  const cooldownSeconds = getIncidentRedetectCooldownSeconds();
  const sinceResolvedSeconds = lastResolvedOutageAgeSeconds(recent);
  const inCooldown = sinceResolvedSeconds < cooldownSeconds;

  const openedLastHour = outageIncidentsInLastHour(recent);
  const capReached = openedLastHour >= getMaxIncidentsPerHour();

  const decision = decideOutageTick({
    incident,
    force: Boolean(options.force),
    outageActiveNow,
    count5xx,
    inCooldown,
    capReached,
    openedLastHour,
  });

  switch (decision.type) {
    case "detect": {
      incident = await createIncident({
        kind: "outage",
        title: "Booking API 5xx on pricing path",
        event: ev(
          "detected",
          `Elevated 5xx on the booking pricing path (${count5xx} in ${INCIDENT_WINDOW_SECONDS}s).`,
        ),
      });
      const slackRoot = await postSlackWithRef(detectionBlocks(count5xx));
      if (slackRoot) {
        incident = await appendIncidentEvent(
          incident.id,
          createSlackThreadEvent(slackRoot),
        );
      }
      break;
    }
    case "suppressed": {
      if (decision.reason === "cap") {
        console.warn(
          `[ops/tick] outage detection suppressed: ${decision.openedLastHour} incidents already opened in the last hour (cap ${getMaxIncidentsPerHour()}).`,
        );
      }
      break;
    }
    case "progress":
      incident = decision.incident;
      break;
    case "healthy":
      break;
  }

  if (incident) {
    const errors = await fetchErrors(8);

    if (agentsAvailable()) {
      if (!incident.summarizerAgentId) {
        try {
          const id = await launchSummarizer(errors);
          incident = await patchIncident(incident.id, { summarizerAgentId: id });
          await appendIncidentEvent(incident.id, ev("summarizer_launched", "Summarizer cloud agent launched."));
        } catch (err) {
          await appendIncidentEvent(incident.id, ev("agent_error", `Summarizer launch failed: ${errMsg(err)}`));
        }
      }
      if (!incident.fixerAgentId) {
        try {
          const id = await launchFixer(errors);
          incident = await patchIncident(incident.id, { fixerAgentId: id });
          await appendIncidentEvent(incident.id, ev("fixer_launched", "Fixer cloud agent launched (will open a PR)."));
        } catch (err) {
          await appendIncidentEvent(incident.id, ev("agent_error", `Fixer launch failed: ${errMsg(err)}`));
        }
      }
    } else if (!incident.summaryPosted) {
      await postSlack(
        summaryBlocks(SIMULATED_SUMMARY),
        slackReplyOptions(incident),
      );
      incident = await patchIncident(incident.id, { summaryPosted: true });
      await appendIncidentEvent(incident.id, ev("summary_posted", "Incident summary posted to Slack (simulated; no CURSOR_API_KEY)."));
    }

    if (incident.summarizerAgentId && !incident.summaryPosted) {
      const status = await getAgentStatus(incident.summarizerAgentId);
      if (status.status === "finished" && status.finalText) {
        await postSlack(
          summaryBlocks(status.finalText, incident.summarizerAgentId),
          slackReplyOptions(incident),
        );
        incident = await patchIncident(incident.id, { summaryPosted: true });
        await appendIncidentEvent(incident.id, ev("summary_posted", "Exec-readable incident summary posted to Slack."));
      }
    }

    if (incident.fixerAgentId && !incident.prPosted) {
      const status = await getAgentStatus(incident.fixerAgentId);
      if (status.prUrl) {
        incident = await patchIncident(incident.id, {
          prUrl: status.prUrl,
          prNumber: status.prNumber,
          prPosted: true,
        });
        await postSlack(
          prBlocks(
            status.prUrl,
            status.prNumber ?? 0,
            incident.fixerAgentId,
          ),
          slackReplyOptions(incident),
        );
        await appendIncidentEvent(incident.id, ev("pr_opened", `Fix PR opened for review: ${status.prUrl}`, { prUrl: status.prUrl }));
      }
    }

    incident = await ensureDemoLabeled(incident);

    if (healthy) {
      const next = incident.greenTicks + 1;
      if (next >= RECOVERY_GREEN_TICKS) {
        await patchIncident(incident.id, {
          status: "resolved",
          resolvedAt: new Date().toISOString(),
          greenTicks: next,
        });
        await appendIncidentEvent(incident.id, ev("recovered", "Pricing endpoints healthy again. Incident resolved."));
        await postSlack(recoveryBlocks(), slackReplyOptions(incident));
        incident = null;
      } else {
        incident = await patchIncident(incident.id, { greenTicks: next });
      }
    } else if (incident.greenTicks !== 0) {
      incident = await patchIncident(incident.id, { greenTicks: 0 });
    }
  }

  return flags;
}

function lastResolvedOutageAgeSeconds(recent: OpsIncident[]): number {
  let newest = 0;
  for (const i of recent) {
    if (incidentKind(i) !== "outage" || i.status !== "resolved" || !i.resolvedAt) {
      continue;
    }
    const t = new Date(i.resolvedAt).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest === 0 ? Number.POSITIVE_INFINITY : (Date.now() - newest) / 1000;
}

function outageIncidentsInLastHour(recent: OpsIncident[]): number {
  const cutoff = Date.now() - 3600_000;
  return recent.filter(
    (i) => incidentKind(i) === "outage" && new Date(i.startedAt).getTime() >= cutoff,
  ).length;
}

function probesAreOnlyTimeouts(probes: { status: number }[]): boolean {
  // If every probe returned status 0 the backend is unreachable (dev server
  // down), not an application outage. Don't open an incident for that.
  return probes.every((p) => p.status === 0);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { OpsError };
