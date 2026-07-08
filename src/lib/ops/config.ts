import "server-only";

// Central config for the incident-response orchestrator. Everything is read from
// the environment so the same code runs locally (open, no secrets) and on
// Vercel (secrets set in the project). Sensible defaults keep local dev
// zero-config.

export const FARE_ADJUSTMENT_FLAG = "fare_adjustment_v2";

export function getBackendBaseUrl(): string {
  return (
    process.env.BOOKING_API_URL ??
    process.env.NEXT_PUBLIC_BOOKING_API_URL ??
    "http://localhost:8787"
  );
}

export function getOpsSharedSecret(): string | undefined {
  return process.env.OPS_SHARED_SECRET || undefined;
}

export function getOpsDashboardPassword(): string | undefined {
  return process.env.OPS_DASHBOARD_PASSWORD || undefined;
}

export function getSlackWebhookUrl(): string | undefined {
  return process.env.SLACK_WEBHOOK_URL || undefined;
}

export function getCursorApiKey(): string | undefined {
  return process.env.CURSOR_API_KEY || undefined;
}

export function getOpsAgentModel(): string | undefined {
  return process.env.OPS_AGENT_MODEL || undefined;
}

export function getGithubToken(): string | undefined {
  return process.env.GITHUB_TOKEN ?? process.env.GH_KEY ?? undefined;
}

// The repo the fix agent works on. Always the booking backend for this
// scenario; the incident machinery deliberately lives elsewhere so the agent
// never sees it.
export function getFixRepo(): string {
  return process.env.OPS_FIX_REPO ?? "flylo-air/booking-backend";
}

export function getFixRepoParts(): { owner: string; repo: string } {
  const [owner, repo] = getFixRepo().split("/");
  if (!owner || !repo) {
    throw new Error("OPS_FIX_REPO must be in owner/repo format");
  }
  return { owner, repo };
}

// Cron/automation shared secret for the tick endpoint. Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`.
export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

// Consecutive green ticks before an incident is marked recovered. Recovery in
// this model is deterministic (someone flips the outage flag off, or it
// auto-expires), so one clean probe is enough.
export const RECOVERY_GREEN_TICKS = 1;

// 5xx count (in the trailing window) that trips an incident.
export const INCIDENT_ERROR_THRESHOLD = 1;
export const INCIDENT_WINDOW_SECONDS = 180;

// Safety net: if the outage flag is left on longer than this, the orchestrator
// flips it back off so a forgotten demo self-heals. 0 disables auto-expiry.
export function getOutageTtlMinutes(): number {
  const raw = process.env.OUTAGE_TTL_MINUTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

// Optional request header carrying the identity of whoever flips the toggle
// (e.g. an SSO-forwarded email when the ops routes are hosted behind SSO). Used
// only for the transparent "flipped by <who>" attribution. Null when unset.
export function getActorHeader(): string | undefined {
  return process.env.OPS_ACTOR_HEADER || undefined;
}

// Endpoints the orchestrator probes to build the status lights. `date` is filled in
// at probe time with a near-future day so search always has candidate flights.
export type ProbeTarget = { id: string; label: string; path: string };

export function getProbeTargets(): ProbeTarget[] {
  const date = futureDateISO(14);
  return [
    { id: "health", label: "API health", path: "/v1/health" },
    { id: "catalog", label: "Airport catalog", path: "/v1/airports" },
    {
      id: "search",
      label: "Flight search / pricing",
      path: `/v1/flights/search?from=SFO&to=LHR&date=${date}`,
    },
  ];
}

function futureDateISO(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
