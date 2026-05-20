import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { CheckoutFlow } from "./CheckoutFlow";
import { bookingApi, ApiError, type SeatMap } from "@/lib/api";

export const metadata: Metadata = {
  title: "Checkout",
};

export const dynamic = "force-dynamic";

type Params = Promise<{ pnr: string }>;

export default async function BookPage({ params }: { params: Params }) {
  const { pnr: rawPnr } = await params;
  const pnr = rawPnr.toUpperCase();

  try {
    const { booking } = await bookingApi.getBooking(pnr);
    if (booking.status === "confirmed") {
      redirect(`/book/${pnr}/confirmation`);
    }

    let seatMap: SeatMap | null = null;
    const segment = booking.segments[0];
    if (segment) {
      try {
        seatMap = await bookingApi.seatMap(segment.flightId, segment.cabin);
      } catch {
        seatMap = null;
      }
    }

    return <CheckoutFlow initialBooking={booking} seatMap={seatMap} />;
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    if (status === 403 || status === 404) {
      return (
        <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
          <SectionLabel index="06" label="Checkout" />
          <h1 className="mt-6 font-display text-[40px] leading-[1.02] tracking-[-0.02em]">
            We can't open this reservation.
          </h1>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
            Bookings are tied to the browser that created them. If you started
            this reservation on another device, look it up via PNR + email on
            the Trips page.
          </p>
          <div className="mt-8 flex gap-3">
            <Link href="/trips" className="btn-ghost">
              <span>Find a trip</span>
              <span aria-hidden>→</span>
            </Link>
            <Link href="/" className="btn-ink">
              <span>Start a new search</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      );
    }

    const message = err instanceof Error ? err.message : String(err);
    return (
      <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
        <SectionLabel index="06" label="Checkout" />
        <h1 className="mt-6 font-display text-[40px] leading-[1.02] tracking-[-0.02em]">
          Something went wrong.
        </h1>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
          The reservations service is unreachable.
        </p>
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
          {message}
        </p>
        <div className="mt-8">
          <Link href="/" className="btn-ghost">
            <span aria-hidden>←</span>
            <span>Back to search</span>
          </Link>
        </div>
      </section>
    );
  }
}
