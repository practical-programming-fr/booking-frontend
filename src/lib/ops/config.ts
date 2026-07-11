import "server-only";

// Central config for the incident-response orchestrator. Everything is read from
// the environment so the same code runs locally (open, no secrets) and on
// Vercel (secrets set in the project). Sensible defaults keep local dev
// zero-config.

export const FARE_ADJUSTMENT_FLAG = "fare_adjustment_v2";

// The benign, self-healing scenario flag. When enabled it drives a
// "degraded performance" (transient) incident that an agent investigates and
// concludes is a non-issue. It never affects probes or 5xx, so the booking
// site stays up the whole time.
export const SPIKE_FLAG = "traffic_spike_sim";

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

// Minimum 5xx count (in the trailing window) that can contribute to opening an
// incident. Detection is anchored to the outage flag / unhealthy probes (see
// the orchestrator), so this only guards a residual count-based path: it is set
// above 1 so a single stray 5xx never opens an incident on its own.
export const INCIDENT_ERROR_THRESHOLD = 3;
export const INCIDENT_WINDOW_SECONDS = 180;

// After an outage incident resolves, suppress opening a NEW outage incident for
// this many seconds unless the outage is observed again by the flag/probe test.
// This is the belt-and-suspenders against trailing-window and flap
// re-triggering: stale 5xx still inside INCIDENT_WINDOW_SECONDS can no longer
// re-open an incident during the cooldown. 0 disables the cooldown.
export function getIncidentRedetectCooldownSeconds(): number {
  const raw = process.env.INCIDENT_REDETECT_COOLDOWN_SECONDS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 300;
}

// Hard safety cap: never open more than this many outage incidents within a
// trailing hour, no matter what detection says. This caps Slack spam and, once
// cloud agents are enabled, cloud-agent spend, even if something upstream flaps.
export function getMaxIncidentsPerHour(): number {
  const raw = process.env.MAX_INCIDENTS_PER_HOUR;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 6;
}

// Safety net: if the outage flag is left on longer than this, the orchestrator
// flips it back off so a forgotten demo self-heals. 0 disables auto-expiry.
export function getOutageTtlMinutes(): number {
  const raw = process.env.OUTAGE_TTL_MINUTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

// How long the benign "degraded performance" scenario runs before it
// self-resolves. The transient incident needs the investigation note posted
// and this TTL elapsed (or the flag flipped off) before it recovers, so a
// forgotten spike demo always heals on its own. Read in seconds.
export function getSpikeTtlSeconds(): number {
  const raw = process.env.SPIKE_TTL_SECONDS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 90;
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
