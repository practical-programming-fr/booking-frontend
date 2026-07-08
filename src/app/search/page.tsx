import Link from "next/link";
import type { Metadata } from "next";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { bookingApi, ApiError, type SearchResponse } from "@/lib/api";
import {
  formatClockInZone,
  formatDuration,
  formatFare,
  formatTravelDate,
  dayOffsetBetween,
} from "@/lib/format";
import { getRelativeLocalDateInputValue } from "@/lib/date-input";

type SearchParams = Promise<{
  from?: string;
  to?: string;
  date?: string;
  cabin?: string;
  pax?: string;
}>;

export const metadata: Metadata = {
  title: "Search",
  description: "Live FlyLo search results.",
};

export const dynamic = "force-dynamic";

const CABIN_NAMES: Record<"A" | "P" | "L", string> = {
  A: "Atlas Suite",
  P: "Prospect",
  L: "Linen",
};

function clampPax(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(9, Math.floor(n)));
}

function normaliseCabin(value: string | undefined): "A" | "P" | "L" | undefined {
  if (value === "A" || value === "P" || value === "L") {
    return value;
  }
  return undefined;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const from = (sp.from ?? "LHR").toUpperCase();
  const to = (sp.to ?? "HND").toUpperCase();
  const date =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? sp.date
      : getRelativeLocalDateInputValue(21);
  const cabin = normaliseCabin(sp.cabin);
  const pax = clampPax(sp.pax);

  let data: SearchResponse | null = null;
  let error: string | null = null;
  let outage = false;

  try {
    data = await bookingApi.searchFlights({ from, to, date, pax, cabin });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    // A 5xx from the booking API is a service outage (as opposed to the
    // backend being unreachable in local dev). Show a production-style
    // "temporarily unavailable" state rather than a developer hint.
    outage = err instanceof ApiError ? err.status >= 500 : false;
  }

  const results = data?.results ?? [];

  return (
    <section className="container-rams pt-12 pb-20 md:pt-16 md:pb-28">
      <SectionLabel index="02" label="Search" />
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1
          className="font-display leading-[0.96] tracking-[-0.02em]"
          style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
        >
          {from} <span className="text-[color:var(--ink-soft)]">→</span> {to}
        </h1>
        <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
          <div>
            <dt className="text-[color:var(--ink-mute)]">Depart</dt>
            <dd className="mt-1 tabular-nums text-[color:var(--ink)]">
              {formatTravelDate(`${date}T12:00:00Z`)}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--ink-mute)]">Pax</dt>
            <dd className="mt-1 tabular-nums text-[color:var(--ink)]">{pax}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--ink-mute)]">Cabin</dt>
            <dd className="mt-1 text-[color:var(--ink)]">
              {cabin ? `${cabin} · ${CABIN_NAMES[cabin]}` : "Any"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href={`/?${new URLSearchParams({ from, to, date, cabin: cabin ?? "L", pax: String(pax) }).toString()}`}
          className="btn-ghost"
        >
          <span aria-hidden>←</span>
          <span>Refine search</span>
        </Link>
      </div>

      {error && outage && (
        <div className="mt-12 border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-6 py-10">
          <p className="eyebrow" style={{ color: "var(--accent)" }}>
            Booking temporarily unavailable
          </p>
          <h2 className="mt-3 font-display text-[32px] leading-[1.05]">
            We are having trouble pricing flights right now.
          </h2>
          <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
            Our team has been alerted and is already on it. Please try again in
            a few minutes. Existing trips and check-in are unaffected.
          </p>
          <div className="mt-6">
            <Link href="/trips" className="btn-ghost">
              <span>View my trips</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      )}

      {error && !outage && (
        <div className="mt-12 border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-6 py-8">
          <p className="eyebrow">Atlas · offline</p>
          <h2 className="mt-3 font-display text-[28px] leading-[1.05]">
            Couldn't reach the booking service.
          </h2>
          <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
            Start the backend with{" "}
            <code className="font-mono text-[12px] text-[color:var(--ink)]">npm run dev</code>{" "}
            in <code className="font-mono text-[12px] text-[color:var(--ink)]">booking-backend</code>,
            then refresh.
          </p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            {error}
          </p>
        </div>
      )}

      {!error && results.length === 0 && (
        <div className="mt-16 border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-6 py-10 text-center">
          <p className="eyebrow">No departures</p>
          <h2 className="mt-4 font-display text-[32px] leading-[1.05]">
            Nothing scheduled on this pair for {formatTravelDate(`${date}T12:00:00Z`)}.
          </h2>
          <p className="mt-3 max-w-[44ch] mx-auto text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
            Try a different date, swap origin and destination, or pick another
            city — the network connects two hubs (LHR, SFO) to every
            destination on the network.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-12 border-t border-[color:var(--rule)]">
          {results.map((result) => {
            const dayOffset = dayOffsetBetween(result.departAt, result.arriveAt);
            const cheapestFare = result.fares
              .slice()
              .sort((a, b) => a.baseEur - b.baseEur)[0];

            return (
              <article
                key={result.id}
                className="border-b border-[color:var(--rule)] py-8"
              >
                <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:items-end">
                  <div>
                    <p className="eyebrow">
                      {result.flightNo} · {result.aircraft}
                    </p>
                    <div className="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                      <div>
                        <div className="font-display text-[42px] leading-none tracking-[-0.02em] tabular-nums">
                          {formatClockInZone(result.departAt, "UTC")}
                        </div>
                        <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                          {result.from}
                        </div>
                      </div>

                      <div className="hidden flex-col items-center text-[color:var(--ink-mute)] md:flex">
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
                          {formatDuration(result.durationMin)}
                        </span>
                        <span
                          aria-hidden
                          className="my-1 block h-px w-24 bg-[color:var(--rule)]"
                        />
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
                          Direct
                        </span>
                      </div>

                      <div className="text-right">
                        <div className="font-display text-[42px] leading-none tracking-[-0.02em] tabular-nums">
                          {formatClockInZone(result.arriveAt, "UTC")}
                          {dayOffset > 0 && (
                            <sup className="ml-1 align-super text-[14px] font-mono tracking-normal text-[color:var(--ink-soft)]">
                              +{dayOffset}
                            </sup>
                          )}
                        </div>
                        <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                          {result.to}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="eyebrow">From</p>
                    <p className="mt-2 font-display text-[40px] leading-none tracking-[-0.01em] tabular-nums">
                      {cheapestFare ? formatFare(cheapestFare.baseEur) : "—"}
                    </p>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-mute)]">
                      per passenger
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="flex flex-wrap gap-2">
                    {result.fares.map((fare) => (
                      <div
                        key={fare.cabin}
                        className="flex items-baseline gap-2 border border-[color:var(--rule)] bg-[color:var(--paper)] px-3 py-2"
                      >
                        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                          {fare.cabin} · {CABIN_NAMES[fare.cabin]}
                        </span>
                        <span className="font-mono text-[13px] tabular-nums text-[color:var(--ink)]">
                          {formatFare(fare.baseEur)}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
                          {fare.seatsAvailable} left
                        </span>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={`/flights/${result.id}?${new URLSearchParams({ pax: String(pax), cabin: cabin ?? "L" }).toString()}`}
                    className="btn-ink justify-self-end"
                  >
                    <span>Select</span>
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
