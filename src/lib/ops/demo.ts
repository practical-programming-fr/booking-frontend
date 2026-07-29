import "server-only";

import { INCIDENT_WINDOW_SECONDS } from "./config";
import {
  appendIncidentEvent,
  createIncident,
  fetchErrorCount,
  fetchErrors,
  fetchIncidents,
  listDemoSessions,
  patchIncident,
} from "./backend";
import {
  agentsAvailable,
  getAgentStatus,
  launchFixer,
  launchSummarizer,
} from "./agents";
import { ensureDemoLabeled } from "./labeling";
import {
  detectionBlocks,
  postSlack,
  prBlocks,
  recoveryBlocks,
  summaryBlocks,
} from "./slack";
import type { DemoSession, IncidentEvent, OpsIncident } from "./types";

// Per-session ("scoped") incident arc.
//
// A presenter's scoped outage drives the SAME full arc as the global outage
// (detect -> Slack detection -> summarizer + fixer cloud agents -> Slack PR ->
// recovery), but keyed off, and routed to, that presenter's own session and
// Slack channel, so a hundred simultaneous demos never collide.
//
// The design is deliberately additive. Session incidents reuse the existing
// backend incident store with kind "outage", but tag their title with a
// [demo:<id>] marker. The global outage path (orchestrator.ts) filters these
// out, so global behavior is unchanged and the two never clobber each other.

const DEMO_TITLE_TAG = /\[demo:([^\]]+)\]/;

// True for incidents that belong to a scoped demo session (not the global one).
export function isSessionScopedIncident(i: { title?: string }): boolean {
  return DEMO_TITLE_TAG.test(i.title ?? "");
}

export function demoSessionIdOfIncident(i: { title?: string }): string | null {
  const m = DEMO_TITLE_TAG.exec(i.title ?? "");
  return m ? m[1] : null;
}

function sessionIncidentTitle(id: string): string {
  return `Booking API 5xx on pricing path [demo:${id}]`;
}

function ev(
  kind: string,
  message: string,
  data?: Record<string, unknown>,
): IncidentEvent {
  return { at: new Date().toISOString(), kind, message, data };
}

// The Slack channel is captured on the detection event so recovery can route to
// the same channel even after the session has expired off the active list.
function channelOfIncident(i: OpsIncident): string | null {
  for (const e of i.events ?? []) {
    const ch = (e.data as { channel?: unknown } | undefined)?.channel;
    if (typeof ch === "string" && ch) return ch;
  }
  return null;
}

const SIMULATED_SUMMARY =
  "*Impact:* Customers cannot search or book flights; the pricing endpoints are returning errors.\n" +
  "*Likely cause:* A fuel-surcharge lookup in the pricing path fails for every route, throwing on each request.\n" +
  "*Next step:* A small fix to the surcharge route-key lookup is being prepared.";

// One step of the per-session state machine. Wrapped by the caller so any
// failure degrades gracefully and never throws out of the tick.
export async function runDemoSessionsTick(): Promise<void> {
  const sessions = await listDemoSessions();
  const recent = await fetchIncidents(100);
  const sessionIncidents = recent.filter(isSessionScopedIncident);

  const activeArcSessions = sessions.filter((s) => s.active && s.runFullArc);
  const activeArcIds = new Set(activeArcSessions.map((s) => s.id));

  // Progress (or open) an incident for each active, full-arc session.
  for (const session of activeArcSessions) {
    try {
      await progressSession(session, sessionIncidents);
    } catch (err) {
      console.warn(
        `[ops/tick] demo session ${session.id} handling failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Recover any open session incident whose session is no longer active with a
  // full arc (resolved by the presenter, expired by TTL, or switched to quiet).
  for (const incident of sessionIncidents) {
    if (incident.status !== "open") continue;
    const id = demoSessionIdOfIncident(incident);
    if (id && activeArcIds.has(id)) continue;
    try {
      await recoverSession(incident);
    } catch (err) {
      console.warn(
        "[ops/tick] demo session recovery failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

async function progressSession(
  session: DemoSession,
  sessionIncidents: OpsIncident[],
): Promise<void> {
  const channel = session.slackChannel ?? undefined;

  // One incident per session for its whole lifetime: scan ALL statuses. Since a
  // demo session id is unique and never reused, this makes re-opening in a loop
  // impossible while still driving the arc exactly once.
  let incident =
    sessionIncidents.find(
      (i) => demoSessionIdOfIncident(i) === session.id,
    ) ?? null;

  // --- Detect --------------------------------------------------------------
  if (!incident) {
    let count = 0;
    try {
      count = await fetchErrorCount(INCIDENT_WINDOW_SECONDS, session.id);
    } catch {
      // scoped count is best-effort flavor only
    }
    incident = await createIncident({
      kind: "outage",
      title: sessionIncidentTitle(session.id),
      event: ev(
        "detected",
        `Scoped demo outage detected for session ${session.id}. Elevated 5xx on the booking pricing path.`,
        { demoSessionId: session.id, channel: channel ?? null },
      ),
    });
    await postSlack(detectionBlocks(count), { channel });
  }

  // Only an open incident needs its agents / summary / PR driven forward.
  if (incident.status !== "open") return;

  let scopedErrors = [] as Awaited<ReturnType<typeof fetchErrors>>;
  try {
    scopedErrors = await fetchErrors(8, session.id);
  } catch {
    // ignore: agent prompts degrade to no samples
  }

  // --- Launch agents once --------------------------------------------------
  if (agentsAvailable()) {
    if (!incident.summarizerAgentId) {
      try {
        const id = await launchSummarizer(scopedErrors);
        incident = await patchIncident(incident.id, { summarizerAgentId: id });
        await appendIncidentEvent(
          incident.id,
          ev("summarizer_launched", "Summarizer cloud agent launched for this session."),
        );
      } catch (err) {
        await appendIncidentEvent(
          incident.id,
          ev("agent_error", `Summarizer launch failed: ${errMsg(err)}`),
        );
      }
    }
    if (!incident.fixerAgentId) {
      try {
        const id = await launchFixer(scopedErrors);
        incident = await patchIncident(incident.id, { fixerAgentId: id });
        await appendIncidentEvent(
          incident.id,
          ev("fixer_launched", "Fixer cloud agent launched for this session (will open a PR)."),
        );
      } catch (err) {
        await appendIncidentEvent(
          incident.id,
          ev("agent_error", `Fixer launch failed: ${errMsg(err)}`),
        );
      }
    }
  } else if (!incident.summaryPosted) {
    // Degraded local mode: no agents, still show the summary beat per session.
    await postSlack(summaryBlocks(SIMULATED_SUMMARY), { channel });
    incident = await patchIncident(incident.id, { summaryPosted: true });
    await appendIncidentEvent(
      incident.id,
      ev("summary_posted", "Incident summary posted to Slack (simulated; no CURSOR_API_KEY)."),
    );
  }

  // --- Summarizer finished -> post summary ---------------------------------
  if (incident.summarizerAgentId && !incident.summaryPosted) {
    const status = await getAgentStatus(incident.summarizerAgentId);
    if (status.status === "finished" && status.finalText) {
      await postSlack(summaryBlocks(status.finalText), { channel });
      incident = await patchIncident(incident.id, { summaryPosted: true });
      await appendIncidentEvent(
        incident.id,
        ev("summary_posted", "Exec-readable incident summary posted to Slack."),
      );
    }
  }

  // --- Fixer opened a PR -> post the link -----------------------------------
  if (incident.fixerAgentId && !incident.prPosted) {
    const status = await getAgentStatus(incident.fixerAgentId);
    if (status.prUrl) {
      incident = await patchIncident(incident.id, {
        prUrl: status.prUrl,
        prNumber: status.prNumber,
        prPosted: true,
      });
      await postSlack(prBlocks(status.prUrl, status.prNumber ?? 0), { channel });
      await appendIncidentEvent(
        incident.id,
        ev("pr_opened", `Fix PR opened for review: ${status.prUrl}`, {
          prUrl: status.prUrl,
        }),
      );
    }
  }

  // Label the PR `demo` so the nightly demo-cleanup can find and close it.
  // Retried on every tick until it succeeds; failures are recorded loudly on
  // the timeline, never swallowed. The label is cleanup's only signal.
  incident = await ensureDemoLabeled(incident);
}

async function recoverSession(incident: OpsIncident): Promise<void> {
  const channel = channelOfIncident(incident) ?? undefined;
  await patchIncident(incident.id, {
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  });
  await appendIncidentEvent(
    incident.id,
    ev("recovered", "Scoped demo outage cleared. Session resolved."),
  );
  await postSlack(recoveryBlocks(), { channel });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
