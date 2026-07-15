import "server-only";

import { getBackendBaseUrl, getOpsSharedSecret } from "./config";
import type {
  DemoSession,
  OpsError,
  OpsFlag,
  OpsIncident,
  IncidentEvent,
  IncidentKind,
} from "./types";

// A missing kind on a row predates the kind column; treat it as an outage.
export function incidentKind(incident: OpsIncident): IncidentKind {
  return incident.kind ?? "outage";
}

// Thin server-side client for booking-backend's /v1/_ops API. Every call
// carries the shared secret as a bearer token when one is configured.

async function opsFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = getBackendBaseUrl();
  const secret = getOpsSharedSecret();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (secret) {
    headers.set("Authorization", `Bearer ${secret}`);
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      // ignore
    }
    throw new Error(`ops backend ${path} failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchFlags(): Promise<OpsFlag[]> {
  const data = await opsFetch<{ flags: OpsFlag[] }>("/v1/_ops/flags");
  return data.flags;
}

export async function setFlag(
  key: string,
  enabled: boolean,
  actor?: string | null,
): Promise<OpsFlag[]> {
  const data = await opsFetch<{ flags: OpsFlag[] }>("/v1/_ops/flags", {
    method: "POST",
    body: JSON.stringify({ key, enabled, actor: actor ?? null }),
  });
  return data.flags;
}

export async function fetchErrors(
  limit = 50,
  demoSessionId?: string,
): Promise<OpsError[]> {
  // The demoSessionId query param scopes errors to a single demo session (the
  // backend stamps demo_session_id on scoped ops_errors rows). It is additive:
  // a backend that ignores the param simply returns unscoped errors, which is a
  // harmless superset for the agent prompt.
  const qs = demoSessionId
    ? `?limit=${limit}&demoSessionId=${encodeURIComponent(demoSessionId)}`
    : `?limit=${limit}`;
  const data = await opsFetch<{ errors: OpsError[] }>(`/v1/_ops/errors${qs}`);
  return data.errors;
}

export async function fetchErrorCount(
  sinceSeconds: number,
  demoSessionId?: string,
): Promise<number> {
  const qs = demoSessionId
    ? `?since=${sinceSeconds}&demoSessionId=${encodeURIComponent(demoSessionId)}`
    : `?since=${sinceSeconds}`;
  const data = await opsFetch<{ count: number }>(`/v1/_ops/errors/count${qs}`);
  return data.count;
}

export async function fetchOpenIncident(): Promise<OpsIncident | null> {
  const data = await opsFetch<{ incident: OpsIncident | null }>(
    "/v1/_ops/incidents/open",
  );
  return data.incident;
}

export async function fetchIncidents(limit = 10): Promise<OpsIncident[]> {
  const data = await opsFetch<{ incidents: OpsIncident[] }>(
    `/v1/_ops/incidents?limit=${limit}`,
  );
  return data.incidents;
}

// Find the open incident of a specific kind. The backend's /incidents/open
// endpoint returns a single open incident regardless of kind, which is unsafe
// when an outage and a transient are both active, so we scan recent incidents
// and filter by kind + open status. This keeps the two scenarios independent.
export async function fetchOpenIncidentByKind(
  kind: IncidentKind,
  scan = 20,
): Promise<OpsIncident | null> {
  const list = await fetchIncidents(scan);
  return (
    list.find((i) => i.status === "open" && incidentKind(i) === kind) ?? null
  );
}

export async function createIncident(input: {
  title?: string;
  kind?: IncidentKind;
  event: IncidentEvent;
}): Promise<OpsIncident> {
  const data = await opsFetch<{ incident: OpsIncident }>("/v1/_ops/incidents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.incident;
}

export async function appendIncidentEvent(
  id: string,
  event: IncidentEvent,
): Promise<OpsIncident> {
  const data = await opsFetch<{ incident: OpsIncident }>(
    `/v1/_ops/incidents/${id}/events`,
    { method: "POST", body: JSON.stringify(event) },
  );
  return data.incident;
}

export type IncidentPatch = {
  status?: "open" | "resolved";
  resolvedAt?: string | null;
  summarizerAgentId?: string | null;
  fixerAgentId?: string | null;
  summaryPosted?: boolean;
  prUrl?: string | null;
  prNumber?: number | null;
  prPosted?: boolean;
  greenTicks?: number;
};

export async function patchIncident(
  id: string,
  patch: IncidentPatch,
): Promise<OpsIncident> {
  const data = await opsFetch<{ incident: OpsIncident }>(
    `/v1/_ops/incidents/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.incident;
}

export async function resetOps(): Promise<void> {
  await opsFetch<{ ok: boolean }>("/v1/_ops/reset", { method: "POST" });
}

// --- Per-session ("scoped") demo outages -----------------------------------
//
// These call the backend's /v1/_ops/demo-sessions routes. The exact request and
// response shapes are ASSUMED (the backend lives in a separate repo we do not
// modify here) and normalized in one place (normalizeDemoSession) so they are
// trivial to adjust if the real shapes differ. See the PR description for the
// assumed contract.

// Tolerantly read a demo session out of whatever the backend returns. The
// confirmed backend shape per session is { sessionId (id alias), slackChannel,
// runFullArc, expiresAt, createdAt, kind }. We still accept snake_case and a
// couple of aliases defensively, and infer `active` (GET only lists active
// sessions, so an absent active/status reads as active). Anything missing
// degrades to a safe default.
export function normalizeDemoSession(raw: unknown): DemoSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = (r.sessionId ?? r.id ?? r.demoSessionId ?? r.session_id) as
    | string
    | undefined;
  if (!id || typeof id !== "string") return null;
  const status = (r.status ?? r.state) as string | undefined;
  const activeRaw = r.active ?? r.isActive ?? r.is_active;
  const active =
    typeof activeRaw === "boolean"
      ? activeRaw
      : status
        ? status === "active" || status === "open"
        : true;
  const slackChannel =
    (r.slackChannel ?? r.slack_channel ?? r.channel ?? null) as string | null;
  const runFullArcRaw =
    r.runFullArc ?? r.run_full_arc ?? r.fullArc ?? r.full_arc;
  const runFullArc =
    typeof runFullArcRaw === "boolean" ? runFullArcRaw : true;
  const createdAt = (r.createdAt ?? r.created_at ?? null) as string | null;
  const expiresAt = (r.expiresAt ?? r.expires_at ?? null) as string | null;
  return {
    id,
    active,
    slackChannel: slackChannel ?? null,
    runFullArc,
    createdAt: createdAt ?? null,
    expiresAt: expiresAt ?? null,
  };
}

function unwrapSessions(data: unknown): DemoSession[] {
  const arr = Array.isArray(data)
    ? data
    : ((data as { sessions?: unknown[] })?.sessions ?? []);
  return arr
    .map(normalizeDemoSession)
    .filter((s): s is DemoSession => s !== null);
}

export async function createDemoSession(input: {
  id: string;
  slackChannel?: string | null;
  runFullArc: boolean;
  ttlSeconds: number;
}): Promise<DemoSession> {
  // Send both camelCase and snake_case keys so the request works whichever the
  // backend expects. Extra keys are ignored by well-behaved handlers.
  const body = {
    id: input.id,
    sessionId: input.id,
    slackChannel: input.slackChannel ?? null,
    slack_channel: input.slackChannel ?? null,
    runFullArc: input.runFullArc,
    run_full_arc: input.runFullArc,
    ttlSeconds: input.ttlSeconds,
    ttl_seconds: input.ttlSeconds,
  };
  const data = await opsFetch<unknown>("/v1/_ops/demo-sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const wrapped = (data as { session?: unknown }).session ?? data;
  const normalized = normalizeDemoSession(wrapped);
  // Fall back to the input if the backend returns an empty/odd body: we still
  // know the id we asked for, and the cookie/plumbing only needs the id.
  return (
    normalized ?? {
      id: input.id,
      active: true,
      slackChannel: input.slackChannel ?? null,
      runFullArc: input.runFullArc,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
    }
  );
}

export async function deactivateDemoSession(id: string): Promise<void> {
  // The backend takes the id as a PATH param (no query, no body):
  //   DELETE /v1/_ops/demo-sessions/:sessionId
  // It also exposes a POST alias for clients that cannot send a DELETE with a
  // path param, which we fall back to only if the DELETE fails:
  //   POST /v1/_ops/demo-sessions/:sessionId/end
  const path = `/v1/_ops/demo-sessions/${encodeURIComponent(id)}`;
  try {
    await opsFetch<unknown>(path, { method: "DELETE" });
  } catch {
    await opsFetch<unknown>(`${path}/end`, { method: "POST" });
  }
}

export async function listDemoSessions(): Promise<DemoSession[]> {
  const data = await opsFetch<unknown>("/v1/_ops/demo-sessions");
  return unwrapSessions(data);
}
