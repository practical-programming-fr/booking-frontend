import type { Metadata } from "next";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { bookingApi, ApiError } from "@/lib/api";
import {
  dayOffsetBetween,
  formatClockInZone,
  formatDuration,
  formatFare,
  formatTravelDate,
} from "@/lib/format";

export const metadata: Metadata = {
  title: "Confirmation",
};

export const dynamic = "force-dynamic";

type Params = Promise<{ pnr: string }>;

const CABIN_NAMES: Record<"A" | "P" | "L", string> = {
  A: "Atlas Suite",
  P: "Prospect",
  L: "Linen",
};

export default async function ConfirmationPage({
  params,
}: {
  params: Params;
}) {
  const { pnr: rawPnr } = await params;
  const pnr = rawPnr.toUpperCase();

  try {
    const { booking } = await bookingApi.getBooking(pnr);
    const segment = booking.segments[0];
    if (!segment) {
      throw new Error("Booking has no segments");
    }
    const dayOffset = dayOffsetBetween(segment.departAt, segment.arriveAt);
    const succeededPayment = booking.payments.find((p) => p.status === "succeeded");

    return (
      <section className="container-rams pt-12 pb-24 md:pt-16 md:pb-32">
        <SectionLabel index="07" label="Confirmed" />

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow text-[color:var(--signal)]">
              ✓ Reservation issued
            </p>
            <h1
              className="mt-4 font-display leading-[0.96] tracking-[-0.02em]"
              style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
            >
              {pnr}
            </h1>
            <p className="mt-3 text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
              We've sent the itinerary to{" "}
              <span className="font-mono text-[color:var(--ink)]">
                {booking.contact.email ?? "your inbox"}
              </span>
              .
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/trips" className="btn-ghost">
              <span>My trips</span>
              <span aria-hidden>→</span>
            </Link>
            <Link href="/" className="btn-ink">
              <span>Search another flight</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>

        <BoardingPass
          pnr={pnr}
          flightNo={segment.flightNo}
          cabin={segment.cabin}
          from={segment.from}
          to={segment.to}
          departAt={segment.departAt}
          arriveAt={segment.arriveAt}
          dayOffset={dayOffset}
          durationMin={segment.durationMin}
          totalEur={booking.totals.totalEur}
        />

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <div className="border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 p-6">
            <p className="eyebrow">Passengers</p>
            <ul className="mt-5 space-y-4">
              {booking.passengers.map((passenger) => (
                <li
                  key={passenger.passengerNo}
                  className="flex items-baseline justify-between gap-4"
                >
                  <div>
                    <div className="font-display text-[24px] leading-none tracking-[-0.01em]">
                      {passenger.givenName} {passenger.familyName}
                    </div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                      Passenger {passenger.passengerNo}
                      {passenger.loyaltyNo && ` · ${passenger.loyaltyNo}`}
                    </div>
                  </div>
                  <div className="text-right font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                    <div>{passenger.seatId ?? "—"}</div>
                    {passenger.mealId && <div className="mt-1">{passenger.mealId}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 p-6">
            <p className="eyebrow">Receipt</p>
            <dl className="mt-5 font-mono text-[12px]">
              <Row k="Fare" v={formatFare(booking.totals.baseEur)} />
              <Row k="Seats" v={formatFare(booking.totals.seatsEur)} />
              <Row k="Dining" v={formatFare(booking.totals.mealsEur)} />
              <Row k="Taxes" v={formatFare(booking.totals.taxesEur)} />
              <Row k="Surface" v={formatFare(booking.totals.surfaceEur)} />
              {booking.totals.discountEur > 0 && (
                <Row
                  k={booking.promoCode ? `Discount (${booking.promoCode})` : "Discount"}
                  v={`-${formatFare(booking.totals.discountEur)}`}
                  accent
                />
              )}
            </dl>
            <div className="mt-4 border-t border-[color:var(--rule)] pt-4">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Total charged</span>
                <span className="font-display text-[32px] leading-none tabular-nums">
                  {formatFare(booking.totals.totalEur)}
                </span>
              </div>
              {succeededPayment?.cardLast4 && (
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
                  {succeededPayment.cardBrand ?? "Card"} ·••• {succeededPayment.cardLast4}
                </p>
              )}
              <p className="mt-4 text-[11px] leading-[1.55] text-[color:var(--ink-mute)]">
                Demonstration checkout — no real charge has been made.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return (
      <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
        <SectionLabel index="07" label="Confirmation" />
        <h1 className="mt-6 font-display text-[40px] leading-[1.02] tracking-[-0.02em]">
          {status === 404 ? "Reservation not found." : "Couldn't load this reservation."}
        </h1>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
          {err instanceof Error ? err.message : String(err)}
        </p>
        <div className="mt-8">
          <Link href="/trips" className="btn-ghost">
            <span>Find a trip</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    );
  }
}

function BoardingPass({
  pnr,
  flightNo,
  cabin,
  from,
  to,
  departAt,
  arriveAt,
  dayOffset,
  durationMin,
  totalEur,
}: {
  pnr: string;
  flightNo: string;
  cabin: "A" | "P" | "L";
  from: { iata: string; city: string };
  to: { iata: string; city: string };
  departAt: string;
  arriveAt: string;
  dayOffset: number;
  durationMin: number;
  totalEur: number;
}) {
  return (
    <article className="mt-12 grid grid-cols-1 border border-[color:var(--ink)] bg-[color:var(--paper)] md:grid-cols-[1.4fr_auto_1fr]">
      <div className="border-b border-[color:var(--rule)] p-8 md:border-b-0 md:border-r">
        <p className="eyebrow">Boarding pass · {CABIN_NAMES[cabin]}</p>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="font-display text-[72px] leading-none tracking-[-0.02em] tabular-nums">
              {from.iata}
            </div>
            <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
              {from.city}
            </div>
          </div>
          <div className="flex flex-col items-center text-[color:var(--ink-mute)]">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
              {formatDuration(durationMin)}
            </span>
            <span aria-hidden className="my-2 block h-px w-20 bg-[color:var(--rule)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
              FL · Direct
            </span>
          </div>
          <div className="text-right">
            <div className="font-display text-[72px] leading-none tracking-[-0.02em] tabular-nums">
              {to.iata}
            </div>
            <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
              {to.city}
            </div>
          </div>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3 font-mono text-[12px]">
          <div>
            <div className="eyebrow">Depart</div>
            <div className="mt-2 tabular-nums text-[16px] text-[color:var(--ink)]">
              {formatClockInZone(departAt, "UTC")} · {formatTravelDate(departAt)}
            </div>
          </div>
          <div>
            <div className="eyebrow">Arrive</div>
            <div className="mt-2 tabular-nums text-[16px] text-[color:var(--ink)]">
              {formatClockInZone(arriveAt, "UTC")}
              {dayOffset > 0 && (
                <span className="ml-1 text-[12px] text-[color:var(--ink-soft)]">
                  +{dayOffset}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="eyebrow">Flight</div>
            <div className="mt-2 tabular-nums text-[16px] text-[color:var(--ink)]">
              {flightNo}
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden
        className="hidden md:flex flex-col items-center justify-center border-x border-dashed border-[color:var(--rule)] px-2"
      >
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[color:var(--ink-mute)] [writing-mode:vertical-rl]">
          FlyLo · Atlas
        </span>
      </div>

      <div className="grid gap-6 bg-[color:var(--paper-2)] p-8">
        <div>
          <div className="eyebrow">PNR</div>
          <div className="mt-2 font-display text-[48px] leading-none tracking-[-0.02em] tabular-nums">
            {pnr}
          </div>
        </div>
        <div>
          <div className="eyebrow">Cabin</div>
          <div className="mt-2 font-display text-[28px] leading-none tracking-[-0.01em]">
            {CABIN_NAMES[cabin]}
          </div>
        </div>
        <div>
          <div className="eyebrow">Total</div>
          <div className="mt-2 font-display text-[28px] leading-none tracking-[-0.01em] tabular-nums">
            {formatFare(totalEur)}
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink-mute)]">
          Present this record at the gate.
          <br />
          Demonstration ticket — no real travel issued.
        </p>
      </div>
    </article>
  );
}

function Row({
  k,
  v,
  accent = false,
}: {
  k: string;
  v: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt
        className={`text-[10px] uppercase tracking-[0.1em] ${accent ? "text-[color:var(--signal)]" : "text-[color:var(--ink-mute)]"}`}
      >
        {k}
      </dt>
      <dd
        className={`tabular-nums text-right ${accent ? "text-[color:var(--signal)]" : "text-[color:var(--ink)]"}`}
      >
        {v}
      </dd>
    </div>
  );
}
