import "server-only";

import { getBackendBaseUrl, getProbeTargets } from "./config";
import type { ProbeResult } from "./types";

// Probe the key booking endpoints server-side and report per-endpoint health.
// Drives the dashboard status lights and the orchestrator's detect/recover
// logic. Probes run in parallel with a short timeout so a hung backend does
// not stall the tick.

const PROBE_TIMEOUT_MS = 6000;

async function probeOne(target: {
  id: string;
  label: string;
  path: string;
}): Promise<ProbeResult> {
  const base = getBackendBaseUrl();
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${target.path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      id: target.id,
      label: target.label,
      path: target.path,
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      id: target.id,
      label: target.label,
      path: target.path,
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runProbes(): Promise<ProbeResult[]> {
  return Promise.all(getProbeTargets().map(probeOne));
}

export function probesHealthy(probes: ProbeResult[]): boolean {
  return probes.every((p) => p.ok);
}
