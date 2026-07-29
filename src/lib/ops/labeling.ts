import "server-only";

import { DEMO_LABEL, addDemoLabel } from "./agents";
import { appendIncidentEvent } from "./backend";
import type { IncidentEvent, OpsIncident } from "./types";

// Timeline event kinds. `pr_labeled` is the idempotency marker (it is persisted
// with the incident, so it survives across ticks); `label_error` is the loud
// record of a labelling failure so an unlabeled PR is never lost silently.
export const PR_LABELED_EVENT = "pr_labeled";
export const LABEL_ERROR_EVENT = "label_error";

function ev(
  kind: string,
  message: string,
  data?: Record<string, unknown>,
): IncidentEvent {
  return { at: new Date().toISOString(), kind, message, data };
}

// Ensure the incident's fix PR carries the `demo` label so the nightly
// demo-cleanup can find and close it. The fix PRs are never merged (the demo
// recovers via the flag), so the label is cleanup's only signal.
//
// Safe to call on every tick: it no-ops once a `pr_labeled` event is recorded,
// and otherwise retries while the PR exists but is unlabeled. Labelling failures
// are recorded loudly (a `label_error` event plus a console error) rather than
// swallowed, so a PR the cleanup cannot see is diagnosable instead of piling up
// silently.
export async function ensureDemoLabeled(
  incident: OpsIncident,
): Promise<OpsIncident> {
  if (!incident.prUrl) return incident;
  const events = incident.events ?? [];
  if (events.some((e) => e.kind === PR_LABELED_EVENT)) return incident;

  try {
    const labeled = await addDemoLabel(incident.prUrl, incident.prNumber);
    if (!labeled) {
      // No GITHUB_TOKEN (local/simulated run): labelling was skipped, not
      // failed. Leave the incident unmarked so a configured run still retries.
      return incident;
    }
    return await appendIncidentEvent(
      incident.id,
      ev(
        PR_LABELED_EVENT,
        `Tagged fix PR ${incident.prUrl} with the '${DEMO_LABEL}' label for nightly cleanup.`,
        { prUrl: incident.prUrl },
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ops/tick] failed to label fix PR 'demo':", message);
    // Record the failure loudly, but only once, so retries do not flood the
    // timeline. The console error above still fires on every failed attempt.
    if (events.some((e) => e.kind === LABEL_ERROR_EVENT)) return incident;
    return await appendIncidentEvent(
      incident.id,
      ev(
        LABEL_ERROR_EVENT,
        `Could not apply the '${DEMO_LABEL}' label to ${incident.prUrl}: ${message}. Nightly demo-cleanup may not close it automatically.`,
        { prUrl: incident.prUrl },
      ),
    );
  }
}
