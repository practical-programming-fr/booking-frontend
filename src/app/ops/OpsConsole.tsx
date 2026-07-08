"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OUTAGE_FLAG_KEY,
  type OpsIncident,
  type OpsSnapshot,
  type ProbeResult,
} from "@/lib/ops/types";

const POLL_MS = 10_000;
const GREEN = "var(--signal)";
const RED = "var(--accent)";

type Props = {
  initialSnapshot: OpsSnapshot | null;
  initialError: string | null;
  gated: boolean;
};

type Sample = { t: number; count: number; unhealthy: number };

export function OpsConsole({ initialSnapshot, initialError, gated }: Props) {
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(initialSnapshot);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const [history, setHistory] = useState<Sample[]>([]);
  const inFlight = useRef(false);

  const record = useCallback((snap: OpsSnapshot) => {
    setSnapshot(snap);
    setError(null);
    setHistory((prev) => {
      const unhealthy = snap.probes.filter((p) => !p.ok).length;
      const next = [...prev, { t: Date.now(), count: snap.errorRate5xx, unhealthy }];
      return next.slice(-40);
    });
  }, []);

  const call = useCallback(
    async (path: string, label: string, method = "POST") => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(label);
      try {
        const res = await fetch(path, { method });
        const body = (await res.json().catch(() => ({}))) as {
          snapshot?: OpsSnapshot;
          error?: string;
        };
        if (!res.ok || !body.snapshot) {
          setError(body.error ?? `${label} failed`);
        } else {
          record(body.snapshot);
        }
      } catch {
        setError(`${label}: network error`);
      } finally {
        setBusy(null);
        inFlight.current = false;
      }
    },
    [record],
  );

  const tick = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/ops/tick", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        snapshot?: OpsSnapshot;
        error?: string;
      };
      if (res.ok && body.snapshot) record(body.snapshot);
      else if (body.error) setError(body.error);
    } catch {
      // transient; keep last snapshot
    } finally {
      inFlight.current = false;
    }
  }, [record]);

  useEffect(() => {
    if (!polling) return;
    // Defer the first tick out of the effect body so it does not setState
    // synchronously during render.
    const kickoff = setTimeout(() => void tick(), 0);
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [polling, tick]);

  const outageOn = snapshot?.outageEnabled ?? false;
  const incident = snapshot?.incident ?? null;
  const outageFlag = snapshot?.flags.find((f) => f.key === OUTAGE_FLAG_KEY) ?? null;

  // The flag route needs a JSON body, so it gets its own fetch rather than the
  // shared `call` helper.
  const toggleOutage = useCallback(
    async (enabled: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(enabled ? "Injecting outage" : "Clearing flag");
      try {
        const res = await fetch("/api/ops/flag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          snapshot?: OpsSnapshot;
          error?: string;
        };
        if (!res.ok || !body.snapshot) setError(body.error ?? "Toggle failed");
        else record(body.snapshot);
      } catch {
        setError("Toggle: network error");
      } finally {
        setBusy(null);
        inFlight.current = false;
      }
    },
    [record],
  );

  return (
    <section className="container-rams pt-10 pb-24 md:pt-14">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">FlyLo Ops · incident console</p>
          <h1 className="mt-3 font-display text-[40px] leading-[1.0] tracking-[-0.02em] md:text-[56px]">
            Booking API health
          </h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: outageOn ? RED : GREEN }}
            aria-hidden
          />
          <span>{outageOn ? "Degraded · outage flag on" : "Nominal"}</span>
          <button
            type="button"
            onClick={() => setPolling((p) => !p)}
            className="btn-ghost !px-3 !py-1.5"
          >
            {polling ? "Pause" : "Resume"}
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-6 border-l-2 border-[color:var(--accent)] bg-[color:var(--paper-2)]/50 px-4 py-3 font-mono text-[12px] text-[color:var(--ink)]"
        >
          {error}
        </p>
      )}

      {/* Shared-toggle transparency banner: this is one global switch that
          everyone can see. */}
      {outageOn && outageFlag && (
        <div
          className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 px-4 py-3"
          style={{ borderColor: RED, background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: RED }}>
            Outage active
          </span>
          <span className="font-mono text-[11px] text-[color:var(--ink-soft)]">
            since {formatTime(outageFlag.updatedAt)}
            {outageFlag.updatedBy ? ` · flipped by ${outageFlag.updatedBy}` : ""}
          </span>
          <span className="font-mono text-[10.5px] text-[color:var(--ink-mute)]">
            shared toggle · visible to everyone
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {outageOn ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void toggleOutage(false)}
            className="btn-ghost"
          >
            <span>Disable outage flag</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void toggleOutage(true)}
            className="btn-ink"
          >
            <span>Inject 500s (flip failure toggle)</span>
            <span aria-hidden>→</span>
          </button>
        )}
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void call("/api/ops/fire", "Firing agents")}
          className="btn-ghost"
        >
          <span>Fire agents now</span>
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void call("/api/ops/reset", "Resetting")}
          className="btn-ghost"
        >
          <span>Reset</span>
        </button>
        {busy && (
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            {busy}…
          </span>
        )}
      </div>

      <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1fr]">
        {/* Left: probes + error rate + feed */}
        <div>
          <SectionHead index="01" label="Endpoint health" />
          <div className="mt-5 divide-y divide-[color:var(--rule)] border-y border-[color:var(--rule)]">
            {(snapshot?.probes ?? []).map((probe) => (
              <ProbeRow key={probe.id} probe={probe} />
            ))}
            {!snapshot && (
              <p className="py-6 font-mono text-[12px] text-[color:var(--ink-mute)]">
                No snapshot yet.
              </p>
            )}
          </div>

          <div className="mt-10">
            <SectionHead index="02" label="5xx error rate" />
            <div className="mt-5 flex items-end justify-between">
              <div className="font-display text-[52px] leading-none tabular-nums">
                {snapshot?.errorRate5xx ?? 0}
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
                trailing 3 min
              </div>
            </div>
            <Sparkline history={history} />
          </div>

          <div className="mt-10">
            <SectionHead index="03" label="Live error feed" />
            <div className="mt-5 space-y-3">
              {(snapshot?.errors ?? []).slice(0, 6).map((e) => (
                <div
                  key={e.id}
                  className="border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-4 py-3"
                >
                  <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                    <span>
                      {e.method} {e.path}
                    </span>
                    <span style={{ color: RED }}>{e.status}</span>
                  </div>
                  <p className="mt-2 font-mono text-[12px] text-[color:var(--ink)]">
                    {e.message}
                  </p>
                  {e.stack && (
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-[1.5] text-[color:var(--ink-mute)]">
                      {e.stack.split("\n").slice(0, 4).join("\n")}
                    </pre>
                  )}
                </div>
              ))}
              {(snapshot?.errors ?? []).length === 0 && (
                <p className="font-mono text-[12px] text-[color:var(--ink-mute)]">
                  No recent errors.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: incident timeline */}
        <div>
          <SectionHead index="04" label="Incident" />
          {incident ? (
            <IncidentPanel incident={incident} agentsAvailable={snapshot?.agentsAvailable ?? false} />
          ) : (
            <div className="mt-5 border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-5 py-8">
              <p className="font-mono text-[12px] text-[color:var(--ink-soft)]">
                No active incident. Flip the failure toggle to inject seeded
                500s and watch autonomous incident response kick in.
              </p>
            </div>
          )}
          {gated && (
            <p className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
              Restricted console · password gated
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function SectionHead({ index, label }: { index: string; label: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[11px] tabular-nums text-[color:var(--ink-mute)]">
        {index}
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

function ProbeRow({ probe }: { probe: ProbeResult }) {
  const color = probe.ok ? GREEN : RED;
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <span className="text-[14px] text-[color:var(--ink)]">{probe.label}</span>
      </div>
      <div className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.12em]">
        <span style={{ color }}>{probe.status === 0 ? "no route" : probe.status}</span>
        <span className="tabular-nums text-[color:var(--ink-mute)]">
          {probe.latencyMs}ms
        </span>
      </div>
    </div>
  );
}

function Sparkline({ history }: { history: Sample[] }) {
  const max = Math.max(1, ...history.map((h) => h.count));
  return (
    <div className="mt-4 flex h-16 items-end gap-1">
      {history.length === 0 && (
        <span className="font-mono text-[11px] text-[color:var(--ink-mute)]">
          collecting samples…
        </span>
      )}
      {history.map((h, i) => {
        const height = Math.max(2, Math.round((h.count / max) * 60));
        return (
          <span
            key={h.t + "-" + i}
            className="w-2 flex-shrink-0"
            style={{
              height,
              background: h.count > 0 || h.unhealthy > 0 ? RED : GREEN,
              opacity: 0.85,
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  detected: "Incident detected",
  summarizer_launched: "Summarizer agent launched",
  fixer_launched: "Fixer agent launched",
  summary_posted: "Summary posted to Slack",
  pr_opened: "Fix PR opened for review",
  recovered: "Recovered",
  auto_expired: "Outage auto-expired",
  agent_error: "Agent error",
};

function IncidentPanel({
  incident,
  agentsAvailable,
}: {
  incident: OpsIncident;
  agentsAvailable: boolean;
}) {
  const resolved = incident.status === "resolved";
  return (
    <div className="mt-5 border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40">
      <div className="flex items-center justify-between border-b border-[color:var(--rule)] px-5 py-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
            {incident.title}
          </p>
          <p className="mt-1 font-mono text-[10.5px] text-[color:var(--ink-mute)]">
            started {formatTime(incident.startedAt)}
          </p>
        </div>
        <span
          className="font-mono text-[11px] uppercase tracking-[0.14em]"
          style={{ color: resolved ? GREEN : RED }}
        >
          {resolved ? "Resolved" : "Open"}
        </span>
      </div>

      <ol className="px-5 py-4">
        {incident.events.map((e, i) => (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
            <div className="flex flex-col items-center">
              <span
                className="mt-1 inline-block h-2 w-2 rounded-full"
                style={{ background: e.kind === "recovered" ? GREEN : e.kind === "agent_error" ? RED : "var(--ink)" }}
                aria-hidden
              />
              {i < incident.events.length - 1 && (
                <span className="mt-1 w-px flex-1 bg-[color:var(--rule)]" aria-hidden />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-[color:var(--ink)]">
                  {EVENT_LABEL[e.kind] ?? e.kind}
                </span>
                <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--ink-mute)]">
                  {formatTime(e.at)}
                </span>
              </div>
              <p className="mt-1 text-[12.5px] leading-[1.5] text-[color:var(--ink-soft)]">
                {e.message}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {incident.prUrl && (
        <div className="border-t border-[color:var(--rule)] px-5 py-4">
          <a
            href={incident.prUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-ink"
          >
            <span>Review fix PR{incident.prNumber ? ` #${incident.prNumber}` : ""}</span>
            <span aria-hidden>→</span>
          </a>
        </div>
      )}

      {!agentsAvailable && !resolved && (
        <div className="border-t border-[color:var(--rule)] px-5 py-3">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            Agents simulated · set CURSOR_API_KEY for live cloud agents
          </p>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
