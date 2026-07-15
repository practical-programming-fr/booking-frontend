"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Rule } from "@/components/ui/Rule";

type StatusResponse = {
  sessionId: string | null;
  active: boolean;
  session?: {
    id: string;
    active: boolean;
    slackChannel: string | null;
    runFullArc: boolean;
    expiresAt: string | null;
  } | null;
  incident?: {
    status: string;
    summaryPosted: boolean;
    prUrl: string | null;
    prNumber: number | null;
  } | null;
  nocUrl?: string | null;
  error?: string;
};

const POLL_MS = 5000;

export function OpsConsole() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [channel, setChannel] = useState("");
  const [quiet, setQuiet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelDirty = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/ops/demo/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as StatusResponse;
      setStatus(data);
      // Prefill the channel field from the active session until the presenter
      // edits it themselves.
      if (!channelDirty.current && data.session?.slackChannel) {
        setChannel(data.session.slackChannel);
      }
    } catch {
      // transient; the next poll will retry
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const active = Boolean(status?.active);

  async function trigger() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/demo/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel.trim() || null, quiet }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not trigger the outage.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/demo/resolve", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not resolve the outage.");
        return;
      }
      await refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const sessionId = status?.session?.id ?? status?.sessionId ?? null;
  const incident = status?.incident ?? null;
  const nocUrl = status?.nocUrl ?? null;

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Status + controls */}
      <div>
        <div className="eyebrow">Your session status</div>
        <div
          className="mt-4 flex items-center gap-3 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-5 py-4"
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-full"
            style={{
              background: active ? "var(--accent)" : "var(--signal)",
            }}
          />
          <div>
            <div className="font-display text-[20px] leading-tight">
              {active ? "Scoped outage active" : "Service healthy for this browser"}
            </div>
            <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
              {active
                ? "Your booking requests are returning 500s"
                : "No demo session is breaking your requests"}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Slack channel for this incident</span>
            <input
              type="text"
              value={channel}
              onChange={(e) => {
                channelDirty.current = true;
                setChannel(e.target.value);
              }}
              placeholder="#your-channel or C0123ABCD"
              disabled={active}
              className="border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 py-2.5 font-mono text-[13px] text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none disabled:opacity-60"
            />
            <span className="font-mono text-[11px] text-[color:var(--ink-mute)]">
              Where the incident, summary, and fix PR are posted. Needs a Slack
              bot token to reach a specific channel; otherwise it falls back to
              the default incidents channel.
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={quiet}
              onChange={(e) => setQuiet(e.target.checked)}
              disabled={active}
              className="mt-1 h-4 w-4 accent-[color:var(--ink)]"
            />
            <span className="text-[13px] leading-[1.5] text-[color:var(--ink-soft)]">
              <span className="font-medium text-[color:var(--ink)]">
                Visual outage only (no incident / agent)
              </span>
              <br />
              The site still breaks for this browser and shows red in the NOC, but
              no incident is opened and no cloud agent runs.
            </span>
          </label>

          {error ? (
            <p className="font-mono text-[12px] text-[color:var(--accent)]">{error}</p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-ink"
              onClick={trigger}
              disabled={busy || active}
            >
              <span>Trigger outage</span>
              <span aria-hidden>→</span>
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={resolve}
              disabled={busy || !active}
            >
              <span>Resolve / all clear</span>
            </button>
          </div>
        </div>
      </div>

      {/* Session detail */}
      <div className="border border-[color:var(--rule)] bg-[color:var(--paper-2)] p-5">
        <div className="eyebrow">Session detail</div>
        <Rule className="mt-3" />
        <dl className="mt-4 flex flex-col gap-3 text-[13px]">
          <DetailRow label="Session id" value={sessionId ?? "none"} mono />
          <DetailRow
            label="Mode"
            value={
              status?.session
                ? status.session.runFullArc
                  ? "Full incident arc"
                  : "Visual only (quiet)"
                : "none"
            }
          />
          <DetailRow
            label="Channel"
            value={status?.session?.slackChannel ?? "default"}
            mono
          />
          <DetailRow
            label="Incident"
            value={
              incident
                ? `${incident.status}${incident.summaryPosted ? " · summarized" : ""}`
                : active
                  ? "opening"
                  : "none"
            }
          />
          {incident?.prUrl ? (
            <DetailRow
              label="Fix PR"
              value={
                <a
                  href={incident.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-rule text-[color:var(--accent)]"
                >
                  #{incident.prNumber ?? "?"}
                </a>
              }
            />
          ) : null}
          {sessionId ? (
            <DetailRow
              label="Crew NOC"
              value={
                nocUrl ? (
                  <a
                    href={nocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="link-rule"
                  >
                    open ?demo={short(sessionId)}
                  </a>
                ) : (
                  `?demo=${short(sessionId)}`
                )
              }
              mono
            />
          ) : null}
        </dl>
        <p className="mt-5 font-mono text-[11px] leading-[1.5] text-[color:var(--ink-mute)]">
          Open book.flylo-air.com in this same browser to see the scoped 500s.
          The session self-heals on its TTL if you forget to resolve it.
        </p>
      </div>
    </div>
  );
}

function short(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="eyebrow shrink-0">{label}</dt>
      <dd
        className={`text-right ${mono ? "font-mono" : ""} text-[12px] text-[color:var(--ink)] break-all`}
      >
        {value}
      </dd>
    </div>
  );
}
