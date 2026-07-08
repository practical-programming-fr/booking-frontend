import "server-only";

import { getBackendBaseUrl, getOpsSharedSecret } from "./config";
import type { OpsError, OpsFlag, OpsIncident, IncidentEvent, IncidentKind } from "./types";

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

export async function fetchErrors(limit = 50): Promise<OpsError[]> {
  const data = await opsFetch<{ errors: OpsError[] }>(
    `/v1/_ops/errors?limit=${limit}`,
  );
  return data.errors;
}

export async function fetchErrorCount(sinceSeconds: number): Promise<number> {
  const data = await opsFetch<{ count: number }>(
    `/v1/_ops/errors/count?since=${sinceSeconds}`,
  );
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
