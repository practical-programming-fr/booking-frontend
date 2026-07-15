// Shared ops types. Pure types only (no server-only imports) so the API route
// handlers and the orchestrator can share them.

// The single shared outage toggle key (kept here so callers can read it
// without importing the server-only config module).
export const OUTAGE_FLAG_KEY = "fare_adjustment_v2";

// The benign, self-healing scenario flag key (kept here so callers can read it
// without importing the server-only config module).
export const SPIKE_FLAG_KEY = "traffic_spike_sim";

// Per-session ("scoped") outage plumbing. The backend serves 500s only to a
// request that carries this header with the value of an active demo session, so
// a presenter can break the site for their own browser without affecting anyone
// else. The cookie holds that session id first-party on the booking site and is
// forwarded as the header on every booking API call. Kept here (pure, no
// server-only import) so both the browser and server code paths can share them.
export const DEMO_SESSION_HEADER = "x-demo-session";
export const DEMO_SESSION_COOKIE = "flylo_demo_session";

// A per-session demo outage record as returned by the booking-backend
// /v1/_ops/demo-sessions API. The backend shapes are assumed and normalized in
// backend.ts (normalizeDemoSession), so this is the single tolerant shape the
// rest of the app works with. `runFullArc` false means "visual outage only"
// (quiet mode): the site still 500s but the orchestrator opens no incident.
export type DemoSession = {
  id: string;
  active: boolean;
  slackChannel: string | null;
  runFullArc: boolean;
  createdAt: string | null;
  expiresAt: string | null;
};

// Incident kinds. "outage" is the real bug that gets a fix PR; "spike" is the
// benign transient (degraded performance) that an agent investigates and
// concludes is a non-issue. The backend check constraint allows both values.
export type IncidentKind = "outage" | "spike";

export type OpsFlag = {
  key: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

export type OpsError = {
  id: number;
  occurredAt: string;
  method: string;
  path: string;
  status: number;
  message: string;
  stack: string | null;
};

export type IncidentEvent = {
  at: string;
  kind: string;
  message: string;
  data?: Record<string, unknown>;
};

export type OpsIncident = {
  id: string;
  status: string;
  // Older rows may predate the column; treat a missing kind as "outage".
  kind?: IncidentKind;
  title: string;
  startedAt: string;
  resolvedAt: string | null;
  events: IncidentEvent[];
  summarizerAgentId: string | null;
  fixerAgentId: string | null;
  summaryPosted: boolean;
  prUrl: string | null;
  prNumber: number | null;
  prPosted: boolean;
  greenTicks: number;
  updatedAt: string;
};

export type ProbeResult = {
  id: string;
  label: string;
  path: string;
  ok: boolean;
  status: number;
  latencyMs: number;
};

export type OpsSnapshot = {
  now: string;
  outageEnabled: boolean;
  // Whether the benign transient (degraded performance) scenario is active.
  spikeEnabled: boolean;
  flags: OpsFlag[];
  probes: ProbeResult[];
  errors: OpsError[];
  errorRate5xx: number;
  // The most relevant incident to surface (open outage, else open transient,
  // else the most recent). Kept for backward compatibility.
  incident: OpsIncident | null;
  // The open transient incident, if one is active, surfaced separately so both
  // scenarios can be represented at once.
  spikeIncident: OpsIncident | null;
  agentsAvailable: boolean;
};
