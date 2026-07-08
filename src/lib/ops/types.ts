// Shared ops-console types. Pure types only (no server-only imports) so both
// the API route handlers and the client dashboard component can use them.

// The single shared outage toggle key (kept here so the client can read it
// without importing the server-only config module).
export const OUTAGE_FLAG_KEY = "fare_adjustment_v2";

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
  flags: OpsFlag[];
  probes: ProbeResult[];
  errors: OpsError[];
  errorRate5xx: number;
  incident: OpsIncident | null;
  agentsAvailable: boolean;
};
