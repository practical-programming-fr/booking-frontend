// Shared ops types. Pure types only (no server-only imports) so the API route
// handlers and the orchestrator can share them.

// The single shared outage toggle key (kept here so callers can read it
// without importing the server-only config module).
export const OUTAGE_FLAG_KEY = "fare_adjustment_v2";

// The benign, self-healing scenario flag key (kept here so callers can read it
// without importing the server-only config module).
export const SPIKE_FLAG_KEY = "traffic_spike_sim";

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
