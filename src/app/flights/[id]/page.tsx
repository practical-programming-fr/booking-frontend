import type { Metadata } from "next";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { ReserveCabin } from "./ReserveCabin";
import { bookingApi, type FlightDetail, type SeatMap } from "@/lib/api";
import {
  dayOffsetBetween,
  formatClockInZone,
  formatDuration,
  formatFare,
  formatTravelDate,
} from "@/lib/format";

export const metadata: Metadata = {
  title: "Flight detail",
};

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ cabin?: string; pax?: string }>;

function clampPax(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(9, Math.floor(n)));
}

const CABIN_BENEFITS: Record<"A" | "P" | "L", string[]> = {
  A: [
    "Upper-deck private suite",
    "Atelier dining included",
    "Lounge & priority boarding",
    "Two checked bags · 32 kg",
  ],
  P: [
    "Forward cabin with extra pitch",
    "Curated meal selection",
    "Priority boarding",
    "One checked bag · 23 kg",
  ],
  L: [
    "Main cabin studio seat",
    "Comfort menu included",
    "Gigabit Wi-Fi included",
    "One checked bag · 23 kg",
  ],
};

export default async function FlightDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const pax = clampPax(sp.pax);
  const requestedCabin =
    sp.cabin === "A" || sp.cabin === "P" || sp.cabin === "L" ? sp.cabin : null;

  let detail: FlightDetail | null = null;
  let seatMap: SeatMap | null = null;
  let error: string | null = null;

  try {
    const { flight } = await bookingApi.flight(id);
    detail = flight;
    const previewCabin =
      requestedCabin ??
      detail.fares.find((fare) => fare.seatsAvailable > 0)?.cabin ??
      "L";
    try {
      seatMap = await bookingApi.seatMap(id, previewCabin);
    } catch {
      seatMap = null;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error || !detail) {
    return (
      <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
        <SectionLabel index="03" label="Flight" />
        <h1 className="mt-6 font-display text-[40px] leading-[1.02] tracking-[-0.02em]">
          Flight not found.
        </h1>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
          The reservations service either couldn't find this flight or is
          offline. Head back to search and try again.
        </p>
        {error && (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            {error}
          </p>
        )}
        <div className="mt-8">
          <Link href="/" className="btn-ghost">
            <span aria-hidden>←</span>
            <span>Back to search</span>
          </Link>
        </div>
      </section>
    );
  }

  const dayOffset = dayOffsetBetween(detail.departAt, detail.arriveAt);
  const orderedFares = [...detail.fares].sort((a, b) => a.baseEur - b.baseEur);

  return (
    <section className="container-rams pt-12 pb-24 md:pt-16 md:pb-32">
      <SectionLabel index="03" label="Flight" />

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="eyebrow">{detail.flightNo} · {detail.aircraft.model}</p>
          <h1
            className="mt-4 font-display leading-[0.96] tracking-[-0.02em]"
            style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
          >
            {detail.from.iata}{" "}
            <span className="text-[color:var(--ink-soft)]">→</span>{" "}
            {detail.to.iata}
          </h1>
          <p className="mt-3 font-display text-[24px] leading-[1.05] tracking-[-0.01em] text-[color:var(--ink-soft)]">
            {detail.from.city} to {detail.to.city}
          </p>
        </div>
        <Link
          href="/"
          className="link-rule font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
        >
          <span aria-hidden className="mr-1">←</span>
          <span>Refine search</span>
        </Link>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-x-12 gap-y-10 border-y border-[color:var(--rule)] py-10 md:grid-cols-[1.4fr_auto_1.4fr_1fr]">
        <Block
          eyebrow="Depart"
          headline={formatClockInZone(detail.departAt, "UTC")}
          subline={`${detail.from.iata} · ${detail.from.city}`}
          detail={formatTravelDate(detail.departAt)}
        />
        <div className="hidden flex-col items-center justify-center self-stretch border-x border-[color:var(--rule)] px-6 md:flex">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            {formatDuration(detail.durationMin)}
          </span>
          <span aria-hidden className="my-2 block h-px w-24 bg-[color:var(--rule)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            Direct
          </span>
        </div>
        <Block
          eyebrow="Arrive"
          headline={
            <>
              {formatClockInZone(detail.arriveAt, "UTC")}
              {dayOffset > 0 && (
                <sup className="ml-1 align-super font-mono text-[16px] tracking-normal text-[color:var(--ink-soft)]">
                  +{dayOffset}
                </sup>
              )}
            </>
          }
          subline={`${detail.to.iata} · ${detail.to.city}`}
          detail={formatTravelDate(detail.arriveAt)}
        />
        <Block
          eyebrow="Aircraft"
          headline={detail.aircraft.code}
          subline={`${detail.aircraft.seats} seats · ${detail.route.freqPerWeek}×/wk`}
          detail={detail.aircraft.note ?? undefined}
        />
      </div>

      <div className="mt-12">
        <SectionLabel index="04" label="Cabin" />
        <div className="mt-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h2 className="font-display text-[36px] leading-[1.05] tracking-[-0.02em] md:text-[56px]">
            Choose how you fly.
          </h2>
          <p className="max-w-[44ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
            Cabin pricing is per passenger. Hold a seat for ten minutes
            while you finish — no commitment until you confirm.
          </p>
        </div>

        <div className="mt-10 grid gap-px bg-[color:var(--rule)] md:grid-cols-3">
          {(["A", "P", "L"] as const).map((cabinCode) => {
            const fare = orderedFares.find((f) => f.cabin === cabinCode);
            if (!fare) {
              return (
                <article
                  key={cabinCode}
                  className="bg-[color:var(--paper)] p-8 opacity-50"
                >
                  <p className="eyebrow">
                    {cabinCode} · Not offered on this aircraft
                  </p>
                  <h3 className="mt-6 font-display text-[28px] leading-[1.05] tracking-[-0.02em]">
                    Unavailable.
                  </h3>
                </article>
              );
            }
            const isSelected = requestedCabin === cabinCode;
            return (
              <article
                key={cabinCode}
                className="flex flex-col bg-[color:var(--paper)] p-8"
                data-selected={isSelected}
                style={isSelected ? { background: "var(--paper-2)" } : undefined}
              >
                <p className="eyebrow">{cabinCode} · {fare.cabinName}</p>
                <h3 className="mt-5 font-display text-[36px] leading-[1.02] tracking-[-0.02em]">
                  {formatFare(fare.baseEur)}
                  <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    per passenger
                  </span>
                </h3>
                <p className="mt-4 text-[13px] leading-[1.6] text-[color:var(--ink-soft)]">
                  {fare.deck}. {fare.dining}.
                </p>
                <ul className="mt-6 space-y-2 font-mono text-[12px] tracking-[0.04em] text-[color:var(--ink)]">
                  {CABIN_BENEFITS[cabinCode].map((benefit) => (
                    <li key={benefit} className="flex gap-2 leading-[1.5]">
                      <span aria-hidden className="text-[color:var(--accent)]">·</span>
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
                  {fare.seatsAvailable} of {fare.seatsTotal} seats left
                </p>
                <div className="mt-6">
                  <ReserveCabin
                    flightId={detail.id}
                    cabin={cabinCode}
                    pax={pax}
                    disabled={fare.seatsAvailable < pax}
                    label={
                      fare.seatsAvailable < pax
                        ? `Only ${fare.seatsAvailable} left`
                        : `Reserve · ${formatFare(fare.baseEur * pax)}`
                    }
                  />
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {seatMap && (
        <div className="mt-16">
          <SectionLabel index="05" label="Seat map" />
          <div className="mt-6 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <h2 className="font-display text-[32px] leading-[1.05] tracking-[-0.02em] md:text-[48px]">
              {seatMap.cabin === "A" ? "Atlas Suite" : seatMap.cabin === "P" ? "Prospect" : "Linen"} layout.
            </h2>
            <p className="max-w-[44ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
              Live preview of the current load. You pick the exact seat once
              your booking is reserved.
            </p>
          </div>
          <SeatMapPreview seatMap={seatMap} />
        </div>
      )}
    </section>
  );
}

function Block({
  eyebrow,
  headline,
  subline,
  detail,
}: {
  eyebrow: string;
  headline: React.ReactNode;
  subline: string;
  detail?: string;
}) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <div className="mt-3 font-display text-[44px] leading-none tracking-[-0.02em] tabular-nums md:text-[56px]">
        {headline}
      </div>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
        {subline}
      </p>
      {detail && (
        <p className="mt-3 text-[13px] leading-[1.5] text-[color:var(--ink-soft)]">
          {detail}
        </p>
      )}
    </div>
  );
}

function SeatMapPreview({ seatMap }: { seatMap: SeatMap }) {
  const rows = seatMap.layout.rows;
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const col of row.columns) {
      columnSet.add(col);
    }
  }
  const columns = [...columnSet].sort();
  const seatByKey = new Map(seatMap.seats.map((seat) => [seat.seatId, seat]));

  return (
    <div className="mt-8 overflow-x-auto border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-6 py-8">
      <div className="mx-auto inline-block">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `auto repeat(${columns.length}, 36px)`,
          }}
        >
          <div />
          {columns.map((col) => (
            <div
              key={col}
              className="text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]"
            >
              {col}
            </div>
          ))}
          {rows.map((row) => (
            <SeatRow
              key={row.row}
              row={row.row}
              columns={columns}
              rowColumns={row.columns}
              zone={row.zone}
              seatByKey={seatByKey}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SeatRow({
  row,
  columns,
  rowColumns,
  zone,
  seatByKey,
}: {
  row: number;
  columns: string[];
  rowColumns: string[];
  zone: string;
  seatByKey: Map<string, SeatMap["seats"][number]>;
}) {
  return (
    <>
      <div className="flex items-center pr-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
        {row}
      </div>
      {columns.map((col) => {
        if (!rowColumns.includes(col)) {
          return <div key={`${row}-${col}-x`} aria-hidden />;
        }
        const seatId = `${row}${col}`;
        const seat = seatByKey.get(seatId);
        const status = seat?.status ?? "available";
        return (
          <div
            key={seatId}
            className="flex h-9 w-9 items-center justify-center border text-[10px] font-mono tabular-nums"
            title={`${seatId} · ${zone}${seat?.priceEur ? ` · +€${seat.priceEur}` : ""}`}
            style={{
              borderColor:
                status === "taken"
                  ? "var(--ink-mute)"
                  : status === "held"
                    ? "var(--accent)"
                    : "var(--rule)",
              background:
                status === "taken"
                  ? "var(--ink-mute)"
                  : status === "held"
                    ? "color-mix(in srgb, var(--accent) 18%, transparent)"
                    : "var(--paper)",
              color: status === "taken" ? "var(--paper)" : "var(--ink)",
            }}
          >
            {col}
          </div>
        );
      })}
    </>
  );
}
