"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Login screen for the Ops Console. Posts to the existing /api/ops/login route,
// which sets the httpOnly flylo_ops cookie on success. On success we refresh so
// the server component re-renders with the console.
export function OpsLogin({ gated }: { gated: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Sign in failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[420px]">
      <div className="eyebrow">Restricted · Staff sign in</div>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="eyebrow">Console password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={gated ? "Enter password" : "No password set (open in dev)"}
            className="border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 py-2.5 font-mono text-[13px] text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </label>
        {error ? (
          <p className="font-mono text-[12px] text-[color:var(--accent)]">{error}</p>
        ) : null}
        <button type="submit" className="btn-ink self-start" disabled={busy}>
          <span>{busy ? "Signing in" : "Sign in"}</span>
          <span aria-hidden>→</span>
        </button>
      </form>
    </div>
  );
}
