import "server-only";

import {
  FARE_ADJUSTMENT_FLAG,
  INCIDENT_ERROR_THRESHOLD,
  INCIDENT_WINDOW_SECONDS,
  RECOVERY_GREEN_TICKS,
  SPIKE_FLAG,
  getIncidentRedetectCooldownSeconds,
  getMaxIncidentsPerHour,
  getOutageTtlMinutes,
  getSpikeTtlSeconds,
} from "./config";
import {
  appendIncidentEvent,
  createIncident,
  fetchErrorCount,
  fetchErrors,
  fetchFlags,
  fetchIncidents,
  fetchOpenIncidentByKind,
  incidentKind,
  patchIncident,
  setFlag,
} from "./backend";
import { runProbes, probesHealthy } from "./probe";
import {
  agentsAvailable,
  getAgentStatus,
  launchFixer,
  launchInvestigator,
  launchSummarizer,
} from "./agents";
import { ensureDemoLabeled } from "./labeling";
import {
  detectionBlocks,
  prBlocks,
  postSlack,
  postSlackWithRef,
  recoveryBlocks,
  spikeDetectedBlocks,
  spikeInvestigationBlocks,
  spikeRecoveredBlocks,
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
    // Scan a window of recent incidents so we can resolve the open incident of
    // each kind independently (an outage and a transient can both be open).
    fetchIncidents(20),
  ]);
  return snapshotShape(flags, probes, errors, count5xx, recent);
}

// Build the OpsSnapshot fields shared by buildSnapshot and runTick. Surfaces
// both scenarios: outageEnabled/spikeEnabled from the flags, and the open
// incident of each kind derived from the recent list (falling back to the most
// recent incident so a just-resolved timeline stays visible).
function snapshotShape(
  flags: OpsFlag[],
  probes: OpsSnapshot["probes"],
  errors: OpsError[],
  count5xx: number,
  recent: OpsIncident[],
): OpsSnapshot {
  const outage = flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG);
  const spike = flags.find((f) => f.key === SPIKE_FLAG);
  // The global snapshot ignores per-session ("scoped") demo incidents so they
  // never clobber the global view; those are surfaced to presenters via the
  // /api/ops/demo/status route instead.
  const globalOutage = (i: OpsIncident) =>
    incidentKind(i) === "outage" && !isSessionScopedIncident(i);
  const openOutage =
    recent.find((i) => i.status === "open" && globalOutage(i)) ?? null;
  const openSpike =
    recent.find((i) => i.status === "open" && incidentKind(i) === "spike") ?? null;
  const recentGlobal = recent.filter((i) => !isSessionScopedIncident(i));
  return {
    now: new Date().toISOString(),
    outageEnabled: outage?.enabled ?? false,
    spikeEnabled: spike?.enabled ?? false,
    flags,
    probes,
    errors,
    errorRate5xx: count5xx,
    // Prefer the open outage, then the open transient, then the most recent
    // incident (so the resolved/recovered state stays on the timeline).
    incident: openOutage ?? openSpike ?? recentGlobal[0] ?? null,
    spikeIncident: openSpike,
    agentsAvailable: agentsAvailable(),
  };
}

export type TickOptions = { force?: boolean };

// One step of the incident state machine. Idempotent and safe to call
// frequently (Vercel cron ~60s hits it, and callers may invoke it directly).
// Returns the fresh snapshot so callers can render without a second round trip.
export async function runTick(options: TickOptions = {}): Promise<OpsSnapshot> {
  let flags = await fetchFlags();
  const probes = await runProbes();

  // Both scenarios are handled in isolation below. Each block is wrapped so a
  // failure in one (backend, Slack, or agent call) degrades gracefully and can
  // never throw out of the tick or crash the /api/ops/tick route. The tick
  // always returns a snapshot.

  // --- OUTAGE: real bug, keyed off the fare flag + 5xx/probes -------------
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

  // --- TRANSIENT: benign degraded performance, keyed off the spike flag ----
  try {
    flags = await runSpikeTick(flags);
  } catch (err) {
    console.warn("[ops/tick] transient handling failed:", errMsg(err));
  }

  // --- PER-SESSION: scoped demo outages, one independent arc per session ---
  // Additive: does nothing when there are no active demo sessions (or when the
  // backend/secret is not configured). Never touches the global incident.
  try {
    await runDemoSessionsTick();
  } catch (err) {
    console.warn("[ops/tick] demo session handling failed:", errMsg(err));
  }

  // Read incidents fresh so the returned snapshot reflects every event appended
  // during this tick (local copies can lag append-only writes).
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

// The outage state machine (unchanged in observable behavior): auto-expiry,
// detect on 5xx/probes, launch summarizer + fixer, post to Slack, recover after
// N green ticks. Keyed only off the outage flag and 5xx/probes, and it only
// ever touches the open incident of kind "outage". Returns the (possibly
// refreshed) flags so the caller keeps an accurate view after auto-expiry.
async function runOutageTick(
  flags: OpsFlag[],
  probes: OpsSnapshot["probes"],
  count5xx: number,
  options: TickOptions,
): Promise<OpsFlag[]> {
  const healthy = probesHealthy(probes);

  // Auto-expiry safety net: if the outage flag has been on longer than the TTL,
  // flip it back off so a forgotten demo self-heals. Done before reading the
  // incident so the same tick observes the recovered state.
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

  // Read a window of recent incidents once: it gives us the open outage plus
  // the state needed for the post-recovery cooldown and the per-hour cap.
  // Per-session ("scoped") demo incidents are filtered out here so the global
  // path never picks one up, and so scoped incidents do not consume the global
  // cooldown or per-hour cap. The scoped arc runs independently in demo.ts.
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

  // Is the outage actually happening right now? The outage is deterministically
  // controlled by the fare flag (and by genuinely unhealthy probes), so this,
  // not a trailing 5xx count, is the real detection signal. Stale 5xx still
  // inside the trailing window must not keep re-tripping detection once the flag
  // is off and the site is healthy again.
  // Read the enabled state from the (possibly auto-expiry refreshed) flags, not
  // the pre-expiry snapshot, so an expired flag reads as off here.
  const outageEnabledNow =
    flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG)?.enabled ?? false;
  const outageActiveNow =
    outageEnabledNow || (!healthy && !probesAreOnlyTimeouts(probes));

  // Post-recovery cooldown: after an outage incident resolves, do not open a new
  // one for a while unless the outage is observed again by the flag/probe test.
  // This blocks trailing-window and flap re-triggering (the 163-incident loop).
  const cooldownSeconds = getIncidentRedetectCooldownSeconds();
  const sinceResolvedSeconds = lastResolvedOutageAgeSeconds(recent);
  const inCooldown = sinceResolvedSeconds < cooldownSeconds;

  // Hard safety cap: never open more than N outage incidents per trailing hour.
  const openedLastHour = outageIncidentsInLastHour(recent);
  const capReached = openedLastHour >= getMaxIncidentsPerHour();

  // Detection wants to fire on a live outage (flag/probe) or, as a residual
  // path, on genuinely elevated trailing 5xx above the threshold. The count
  // alone can only fire outside the cooldown, so it can never resurrect a just
  // resolved incident from errors still aging out of the window.
  const wantsDetect =
    options.force || outageActiveNow || count5xx >= INCIDENT_ERROR_THRESHOLD;

  // Cooldown only suppresses re-detection when the outage is NOT active now: a
  // genuinely new outage (flag flipped back on / probes unhealthy) still opens.
  const cooldownBlocks = inCooldown && !outageActiveNow && !options.force;

  const shouldDetect = !incident && wantsDetect && !cooldownBlocks && !capReached;

  // --- Detect --------------------------------------------------------------
  if (shouldDetect) {
    incident = await createIncident({
      kind: "outage",
      title: "Booking API 5xx on pricing path",
      event: ev("detected", `Elevated 5xx on the booking pricing path (${count5xx} in ${INCIDENT_WINDOW_SECONDS}s).`),
    });
    const slackRoot = await postSlackWithRef(detectionBlocks(count5xx));
    if (slackRoot) {
      incident = await appendIncidentEvent(
        incident.id,
        createSlackThreadEvent(slackRoot),
      );
    }
  } else if (!incident && wantsDetect && capReached) {
    // Detection would have fired but the per-hour cap tripped. Skip loudly so
    // the safety limit is visible in logs without creating another incident.
    console.warn(
      `[ops/tick] outage detection suppressed: ${openedLastHour} incidents already opened in the last hour (cap ${getMaxIncidentsPerHour()}).`,
    );
  }

  // --- Progress an open incident ------------------------------------------
  if (incident) {
    const errors = await fetchErrors(8);

    // Launch agents once.
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
      // Degraded local mode: no agents, still show the summary beat.
      await postSlack(
        summaryBlocks(SIMULATED_SUMMARY),
        slackReplyOptions(incident),
      );
      incident = await patchIncident(incident.id, { summaryPosted: true });
      await appendIncidentEvent(incident.id, ev("summary_posted", "Incident summary posted to Slack (simulated; no CURSOR_API_KEY)."));
    }

    // Summarizer finished -> post summary to Slack.
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

    // Fixer opened a PR -> post the link to Slack. The PR is the review
    // artifact; it is never merged (the demo recovers via the flag).
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

    // Label the PR `demo` so the nightly demo-cleanup can find and close it.
    // Kept separate from the Slack post above (which fires once) and retried on
    // every tick until it succeeds, because the label is cleanup's only signal.
    // Labelling failures are recorded loudly on the timeline, never swallowed.
    incident = await ensureDemoLabeled(incident);

    // --- Recover -----------------------------------------------------------
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

// Canned investigation conclusion used when no agents are available (local dev)
// or as a fallback so the "investigated, benign" beat always shows and the
// transient always self-heals on the TTL even if an agent is slow.
const SIMULATED_INVESTIGATION =
  "*What we saw:* Booking API responses were briefly slower than usual.\n" +
  "*Assessment:* A short traffic burst; latency recovered on its own. No error rate increase and no failing requests.\n" +
  "*Recommendation:* No action needed; monitoring.";

// The transient / degraded-performance state machine (benign, self-healing).
// Keyed ONLY off the spike flag and its TTL. It never reads probes or 5xx, so
// the booking site stays healthy throughout. It launches at most one
// investigator agent, never a fixer, and never opens a PR. The narrative beat
// is an explicit "investigated and concluded it is a non-issue" conclusion.
async function runSpikeTick(flags: OpsFlag[]): Promise<OpsFlag[]> {
  const spikeFlag = flags.find((f) => f.key === SPIKE_FLAG);
  const spikeEnabled = spikeFlag?.enabled ?? false;
  let incident = await fetchOpenIncidentByKind("spike");

  // --- Detect --------------------------------------------------------------
  if (spikeEnabled && !incident) {
    incident = await createIncident({
      kind: "spike",
      title: "Degraded performance on booking API",
      event: ev("detected", "Elevated latency on the booking API. Site is up; investigating."),
    });
    const slackRoot = await postSlackWithRef(spikeDetectedBlocks());
    if (slackRoot) {
      incident = await appendIncidentEvent(
        incident.id,
        createSlackThreadEvent(slackRoot),
      );
    }
  }

  if (!incident) return flags;

  const ttlSeconds = getSpikeTtlSeconds();
  const ageSec = spikeFlag
    ? (Date.now() - new Date(spikeFlag.updatedAt).getTime()) / 1000
    : Number.POSITIVE_INFINITY;
  const ttlElapsed = ageSec >= ttlSeconds;
  const flagOff = !spikeEnabled;

  // --- Investigate: launch a single investigator agent (never a fixer) -----
  if (agentsAvailable() && !incident.summarizerAgentId && !incident.summaryPosted) {
    try {
      const errors = await fetchErrors(8);
      const id = await launchInvestigator(errors);
      incident = await patchIncident(incident.id, { summarizerAgentId: id });
      await appendIncidentEvent(
        incident.id,
        ev("investigator_launched", "Investigator cloud agent launched to assess the latency."),
      );
    } catch (err) {
      await appendIncidentEvent(incident.id, ev("agent_error", `Investigator launch failed: ${errMsg(err)}`));
    }
  }

  // --- Post the investigation conclusion (the key "non-issue" beat) --------
  if (!incident.summaryPosted) {
    let conclusion: string | null = null;
    if (incident.summarizerAgentId) {
      try {
        const status = await getAgentStatus(incident.summarizerAgentId);
        if (status.status === "finished" && status.finalText) {
          conclusion = status.finalText;
        }
      } catch (err) {
        console.warn("[ops/tick] investigator status failed:", errMsg(err));
      }
    }
    // Fall back to a canned conclusion when there is no agent, or when the flag
    // is off / TTL elapsed and the agent has not concluded yet, so the beat
    // always shows and the transient still self-heals.
    if (!conclusion && (!agentsAvailable() || !incident.summarizerAgentId || ttlElapsed || flagOff)) {
      conclusion = SIMULATED_INVESTIGATION;
    }
    if (conclusion) {
      await postSlack(
        spikeInvestigationBlocks(conclusion, incident.summarizerAgentId),
        slackReplyOptions(incident),
      );
      incident = await patchIncident(incident.id, { summaryPosted: true });
      await appendIncidentEvent(
        incident.id,
        ev("investigation_posted", "Investigation concluded: transient degradation, no code change needed."),
      );
    }
  }

  // --- Resolve: after the conclusion is posted AND the TTL elapsed, or when
  // the flag is turned off. On TTL-driven resolution the flag is flipped off. --
  if (flagOff || (incident.summaryPosted && ttlElapsed)) {
    if (spikeEnabled) {
      await setFlag(SPIKE_FLAG, false, "auto-expiry");
      flags = await fetchFlags();
    }
    await patchIncident(incident.id, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
    await appendIncidentEvent(
      incident.id,
      ev("recovered", "Transient degradation cleared. Resolved with no action needed."),
    );
    await postSlack(
      spikeRecoveredBlocks(),
      slackReplyOptions(incident),
    );
  }

  return flags;
}

// Seconds since the most recent RESOLVED outage incident resolved, or Infinity
// if none has resolved. Drives the post-recovery cooldown.
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

// How many outage incidents were created within the trailing hour. Drives the
// per-hour safety cap.
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
