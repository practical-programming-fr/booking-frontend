import Link from "next/link";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { formatDuration, formatFare } from "@/lib/format";
import { getRelativeLocalDateInputValue } from "@/lib/date-input";
import type { Route } from "@/lib/api";

type Props = {
  hubIata: string;
  hubCity: string;
  routes: Route[];
  cityByIata: Record<string, string>;
};

/**
 * Editorial table of destinations from a given hub. Each row is a deep link
 * into /search pre-filtered to that pair.
 */
export function TrendingDestinations({
  hubIata,
  hubCity,
  routes,
  cityByIata,
}: Props) {
  if (routes.length === 0) {
    return null;
  }

  const date = getRelativeLocalDateInputValue(21);
  const sortedRoutes = [...routes].sort((a, b) => b.freqPerWeek - a.freqPerWeek);

  return (
    <section className="container-rams py-20 md:py-28">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <SectionLabel index="02" label={`From ${hubIata}`} />
          <h2 className="mt-6 font-display text-[40px] leading-[1.02] tracking-[-0.02em] md:text-[56px]">
            Trending from {hubCity}.
          </h2>
        </div>
        <p className="max-w-[40ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
          Frequency-weighted picks across the network. Departure-day prices
          vary; click through for a full calendar and seat map.
        </p>
      </div>

      <div className="mt-12 border-t border-[color:var(--rule)]">
        {sortedRoutes.map((route) => {
          const cityTo = cityByIata[route.to] ?? route.to;
          const href = `/search?${new URLSearchParams({
            from: route.from,
            to: route.to,
            date,
            cabin: "L",
            pax: "1",
          }).toString()}`;

          return (
            <Link
              key={`${route.from}-${route.to}`}
              href={href}
              className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-4 border-b border-[color:var(--rule)] py-6 transition-colors hover:bg-[color:var(--paper-2)] md:grid-cols-[60px_1fr_120px_120px_120px]"
            >
              <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
                {route.to}
              </span>

              <div>
                <div className="font-display text-[28px] leading-none tracking-[-0.01em] md:text-[34px]">
                  {cityTo}
                </div>
                <div className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                  {route.aircraft} · {route.haul === "long" ? "Long haul" : "Short haul"}
                </div>
              </div>

              <div className="hidden text-right md:block">
                <div className="eyebrow">Duration</div>
                <div className="mt-1 font-mono text-[13px] tabular-nums">
                  {formatDuration(route.durationMin)}
                </div>
              </div>

              <div className="hidden text-right md:block">
                <div className="eyebrow">Freq</div>
                <div className="mt-1 font-mono text-[13px] tabular-nums">
                  {route.freqPerWeek}×/wk
                </div>
              </div>

              <div className="text-right">
                <div className="eyebrow">From</div>
                <div className="mt-1 font-display text-[24px] leading-none tracking-[-0.01em] tabular-nums">
                  {formatFare(route.fareFromEur)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
