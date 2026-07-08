import "server-only";

import {
  FARE_ADJUSTMENT_FLAG,
  INCIDENT_ERROR_THRESHOLD,
  INCIDENT_WINDOW_SECONDS,
  RECOVERY_GREEN_TICKS,
  getOutageTtlMinutes,
} from "./config";
import {
  appendIncidentEvent,
  createIncident,
  fetchErrorCount,
  fetchErrors,
  fetchFlags,
  fetchIncidents,
  fetchOpenIncident,
  patchIncident,
  setFlag,
} from "./backend";
import { runProbes, probesHealthy } from "./probe";
import {
  addDemoLabel,
  agentsAvailable,
  getAgentStatus,
  launchFixer,
  launchSummarizer,
} from "./agents";
import {
  detectionBlocks,
  prBlocks,
  postSlack,
  recoveryBlocks,
  summaryBlocks,
} from "./slack";
import type { IncidentEvent, OpsError, OpsSnapshot } from "./types";

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
  const [flags, probes, errors, count5xx, openIncident, recent] = await Promise.all([
    fetchFlags(),
    runProbes(),
    fetchErrors(30),
    fetchErrorCount(INCIDENT_WINDOW_SECONDS),
    fetchOpenIncident(),
    fetchIncidents(1),
  ]);
  const outage = flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG);
  return {
    now: new Date().toISOString(),
    outageEnabled: outage?.enabled ?? false,
    flags,
    probes,
    errors,
    errorRate5xx: count5xx,
    // Show the open incident, or the most recent one (so the resolved/recovered
    // state stays on the timeline after the fix lands).
    incident: openIncident ?? recent[0] ?? null,
    agentsAvailable: agentsAvailable(),
  };
}

export type TickOptions = { force?: boolean };

// One step of the incident state machine. Idempotent and safe to call
// frequently (Vercel cron ~60s hits it, and callers may invoke it directly).
// Returns the fresh snapshot so callers can render without a second round trip.
export async function runTick(options: TickOptions = {}): Promise<OpsSnapshot> {
  let flags = await fetchFlags();

  // Auto-expiry safety net: if the outage flag has been on longer than the TTL,
  // flip it back off so a forgotten demo self-heals. Done before probing so the
  // same tick observes the recovered state.
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

  const probes = await runProbes();
  const healthy = probesHealthy(probes);
  const count5xx = await fetchErrorCount(INCIDENT_WINDOW_SECONDS);
  let incident = await fetchOpenIncident();

  if (autoExpired && incident) {
    await appendIncidentEvent(
      incident.id,
      ev("auto_expired", `Outage flag auto-expired after ${ttl} min; service restored.`),
    );
  }

  const shouldDetect =
    !incident &&
    (options.force || count5xx >= INCIDENT_ERROR_THRESHOLD || (!healthy && !probesAreOnlyTimeouts(probes)));

  // --- Detect --------------------------------------------------------------
  if (shouldDetect) {
    incident = await createIncident({
      title: "Booking API 5xx on pricing path",
      event: ev("detected", `Elevated 5xx on the booking pricing path (${count5xx} in ${INCIDENT_WINDOW_SECONDS}s).`),
    });
    await postSlack(detectionBlocks(count5xx));
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
      await postSlack(summaryBlocks(SIMULATED_SUMMARY));
      incident = await patchIncident(incident.id, { summaryPosted: true });
      await appendIncidentEvent(incident.id, ev("summary_posted", "Incident summary posted to Slack (simulated; no CURSOR_API_KEY)."));
    }

    // Summarizer finished -> post summary to Slack.
    if (incident.summarizerAgentId && !incident.summaryPosted) {
      const status = await getAgentStatus(incident.summarizerAgentId);
      if (status.status === "finished" && status.finalText) {
        await postSlack(summaryBlocks(status.finalText));
        incident = await patchIncident(incident.id, { summaryPosted: true });
        await appendIncidentEvent(incident.id, ev("summary_posted", "Exec-readable incident summary posted to Slack."));
      }
    }

    // Fixer opened a PR -> label it `demo`, post the link to Slack. The PR is
    // the review artifact; it is never merged (the demo recovers via the flag).
    if (incident.fixerAgentId && !incident.prPosted) {
      const status = await getAgentStatus(incident.fixerAgentId);
      if (status.prUrl) {
        incident = await patchIncident(incident.id, {
          prUrl: status.prUrl,
          prNumber: status.prNumber,
          prPosted: true,
        });
        if (status.prNumber) await addDemoLabel(status.prNumber);
        await postSlack(prBlocks(status.prUrl, status.prNumber ?? 0));
        await appendIncidentEvent(incident.id, ev("pr_opened", `Fix PR opened for review: ${status.prUrl}`, { prUrl: status.prUrl }));
      }
    }

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
        await postSlack(recoveryBlocks());
        incident = null;
      } else {
        incident = await patchIncident(incident.id, { greenTicks: next });
      }
    } else if (incident.greenTicks !== 0) {
      incident = await patchIncident(incident.id, { greenTicks: 0 });
    }
  }

  const outage = flags.find((f) => f.key === FARE_ADJUSTMENT_FLAG);
  const errors = await fetchErrors(30);
  // Read the incident fresh so the returned snapshot reflects every event
  // appended during this tick (local copies can lag append-only writes).
  const displayIncident =
    (await fetchOpenIncident()) ?? (await fetchIncidents(1))[0] ?? null;
  return {
    now: new Date().toISOString(),
    outageEnabled: outage?.enabled ?? false,
    flags,
    probes,
    errors,
    errorRate5xx: count5xx,
    incident: displayIncident,
    agentsAvailable: agentsAvailable(),
  };
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
