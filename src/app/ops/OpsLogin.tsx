"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OpsLogin() {
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
        setError(body.error ?? "Sign-in failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="container-rams pt-16 pb-28 md:pt-24">
      <p className="eyebrow">FlyLo Ops · restricted</p>
      <h1 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.02em] md:text-[56px]">
        Incident console
      </h1>
      <p className="mt-3 max-w-[52ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
        This is an internal operations surface. Enter the console password to
        continue.
      </p>
      <form onSubmit={submit} className="mt-8 max-w-[360px]">
        <label
          htmlFor="ops-password"
          className="eyebrow block"
        >
          Password
        </label>
        <input
          id="ops-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mt-2 w-full border border-[color:var(--rule)] bg-[color:var(--paper)] px-3 py-2 font-mono text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--ink)]"
        />
        {error && (
          <p role="alert" className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--accent)]">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn-ink mt-5">
          <span>{busy ? "Checking…" : "Enter"}</span>
          <span aria-hidden>→</span>
        </button>
      </form>
    </section>
  );
}
