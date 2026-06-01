"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { bookingApi, ApiError, type Booking, type SeatMap } from "@/lib/api";
import {
  dayOffsetBetween,
  formatClockInZone,
  formatDuration,
  formatFare,
  formatTravelDate,
} from "@/lib/format";

// Mirror of backend src/data/meals.ts. Small enough to inline; if it
// changes, we can introduce a /v1/meals endpoint.
const MEAL_CATALOG = [
  {
    id: "seasonal",
    name: "Seasonal service",
    description: "Rotating regional menu, warm bread, and dessert course.",
    priceEur: 0,
    cabins: ["A", "P", "L"] as const,
  },
  {
    id: "plant-forward",
    name: "Plant-forward",
    description: "Vegetable-led plates with citrus grains and tea pairing.",
    priceEur: 0,
    cabins: ["A", "P", "L"] as const,
  },
  {
    id: "linen-comfort",
    name: "Comfort tray",
    description: "Bowl, fresh fruit, chocolate sable, and still water set.",
    priceEur: 14,
    cabins: ["P", "L"] as const,
  },
  {
    id: "atelier-tasting",
    name: "Atelier tasting",
    description: "Five-course chef menu with lounge pantry access.",
    priceEur: 36,
    cabins: ["A", "P"] as const,
  },
  {
    id: "sleep-service",
    name: "Sleep service",
    description: "Light supper, herbal tonic, and wake-up espresso pairing.",
    priceEur: 18,
    cabins: ["A", "P", "L"] as const,
  },
];

const CABIN_NAMES: Record<"A" | "P" | "L", string> = {
  A: "Atlas Suite",
  P: "Prospect",
  L: "Linen",
};

const STEPS = [
  { id: "itinerary", label: "Itinerary" },
  { id: "travellers", label: "Travellers" },
  { id: "seats", label: "Seats + meals" },
  { id: "payment", label: "Payment" },
  { id: "review", label: "Review" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

type Props = {
  initialBooking: Booking;
  seatMap: SeatMap | null;
};

type ContactDraft = {
  name: string;
  email: string;
  phone: string;
};

type PassengerDraft = {
  passengerNo: number;
  givenName: string;
  familyName: string;
  loyaltyNo: string;
  notes: string;
};

type PaymentDraft = {
  cardholder: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
  country: string;
  agreeToTerms: boolean;
  agreeToPreview: boolean;
};

export function CheckoutFlow({ initialBooking, seatMap }: Props) {
  const router = useRouter();
  const [booking, setBooking] = useState(initialBooking);
  const [step, setStep] = useState<StepId>("itinerary");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [holdRemaining, setHoldRemaining] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const segment = booking.segments[0];
  const activeCabin = segment?.cabin ?? "L";

  // --- form drafts -----------------------------------------------------
  const [contact, setContact] = useState<ContactDraft>(() => ({
    name: booking.contact.name ?? "Jane Voss",
    email: booking.contact.email ?? "jane@voss.studio",
    phone: booking.contact.phone ?? "+44 20 7946 0920",
  }));
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() =>
    booking.passengers.map((p) => ({
      passengerNo: p.passengerNo,
      givenName: p.givenName,
      familyName: p.familyName,
      loyaltyNo: p.loyaltyNo ?? "",
      notes: p.notes ?? "",
    })),
  );
  const [activePassengerIdx, setActivePassengerIdx] = useState(0);
  const [payment, setPayment] = useState<PaymentDraft>({
    cardholder: "Jane Voss",
    cardNumber: "4242 4242 4242 4242",
    expiry: "08/29",
    cvc: "242",
    country: "United Kingdom",
    agreeToTerms: true,
    agreeToPreview: true,
  });

  // --- hold timer ------------------------------------------------------
  useEffect(() => {
    if (!booking.holdExpiresAt) {
      setHoldRemaining(null);
      return;
    }
    const tick = () => {
      const ms = new Date(booking.holdExpiresAt!).getTime() - Date.now();
      setHoldRemaining(ms);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [booking.holdExpiresAt]);

  const holdExpired =
    booking.holdExpiresAt != null &&
    holdRemaining != null &&
    holdRemaining <= 0 &&
    booking.status !== "confirmed";

  const meals = useMemo(
    () =>
      MEAL_CATALOG.filter((meal) =>
        (meal.cabins as readonly string[]).includes(activeCabin),
      ),
    [activeCabin],
  );

  const allSeatsPicked = booking.passengers.every((p) => p.seatId != null);
  const allMealsPicked = booking.passengers.every((p) => p.mealId != null);
  const allTravellersComplete = passengers.every(
    (p) => p.givenName.trim() && p.familyName.trim(),
  );
  const contactComplete =
    contact.name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email);
  const paymentComplete =
    payment.cardholder.trim() &&
    payment.cardNumber.replace(/\D/g, "").length >= 15 &&
    /^\d{2}\/\d{2}$/.test(payment.expiry) &&
    payment.cvc.replace(/\D/g, "").length >= 3 &&
    payment.country.trim() &&
    payment.agreeToTerms &&
    payment.agreeToPreview;

  const advance = () => {
    setError(null);
    const next = STEPS[stepIndex + 1];
    if (!next) return;
    setStep(next.id);
  };

  const back = () => {
    setError(null);
    const prev = STEPS[stepIndex - 1];
    if (!prev) return;
    setStep(prev.id);
  };

  const wrapMutation = async (fn: () => Promise<{ booking: Booking }>) => {
    setError(null);
    setIsBusy(true);
    try {
      const { booking: next } = await fn();
      setBooking(next);
      return next;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  const updatePassengerSelection = (
    passengerNo: number,
    patch: Partial<Pick<Booking["passengers"][number], "seatId" | "mealId">>,
  ) => {
    setBooking((current) => ({
      ...current,
      passengers: current.passengers.map((passenger) =>
        passenger.passengerNo === passengerNo
          ? { ...passenger, ...patch }
          : passenger,
      ),
    }));
  };

  const submitTravellers = async () => {
    if (!contactComplete) {
      setError("Add a lead contact name + email before continuing.");
      return;
    }
    if (!allTravellersComplete) {
      setError("Every traveller needs a given and family name.");
      return;
    }
    try {
      await wrapMutation(() =>
        bookingApi.updateContact(booking.pnr, {
          name: contact.name.trim(),
          email: contact.email.trim(),
          phone: contact.phone.trim() || undefined,
        }),
      );
      await wrapMutation(() =>
        bookingApi.upsertPassengers(
          booking.pnr,
          passengers.map((p) => ({
            passengerNo: p.passengerNo,
            givenName: p.givenName.trim(),
            familyName: p.familyName.trim(),
            loyaltyNo: p.loyaltyNo.trim() || null,
            notes: p.notes.trim() || null,
          })),
        ),
      );
      setStep("seats");
    } catch {
      // error already surfaced
    }
  };

  const submitSeatsAndMeals = async () => {
    if (!allSeatsPicked) {
      setError("Pick a seat for every traveller before continuing.");
      return;
    }
    try {
      await wrapMutation(() =>
        bookingApi.assignMeals(
          booking.pnr,
          booking.passengers.map((p) => ({
            passengerNo: p.passengerNo,
            mealId: p.mealId ?? "seasonal",
          })),
        ),
      );
      setStep("payment");
    } catch {
      // error already surfaced
    }
  };

  const submitPayment = async () => {
    if (!paymentComplete) {
      setError("Complete the payment form and tick both acknowledgements.");
      return;
    }
    try {
      const { intent, booking: next } = await bookingApi.createPaymentIntent(
        booking.pnr,
      );
      setBooking(next);
      setPaymentId(intent.paymentId);
      setStep("review");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  const confirm = async () => {
    if (!paymentId) {
      setError("Payment intent missing. Go back to the Payment step.");
      return;
    }
    setError(null);
    setIsBusy(true);
    try {
      await bookingApi.confirmPayment(booking.pnr, {
        paymentId,
        card: {
          cardholder: payment.cardholder.trim(),
          last4: payment.cardNumber.replace(/\D/g, "").slice(-4),
          brand: "visa",
        },
      });
      router.push(`/book/${booking.pnr}/confirmation`);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsBusy(false);
    }
  };

  const assignSeat = (seatId: string | null) => {
    const target = booking.passengers[activePassengerIdx];
    if (!target) return;
    const previousBooking = booking;

    setError(null);
    setIsBusy(true);
    updatePassengerSelection(target.passengerNo, { seatId });

    void bookingApi
      .assignSeats(booking.pnr, [{ passengerNo: target.passengerNo, seatId }])
      .then(({ booking: next }) => {
        setBooking(next);
      })
      .catch((err) => {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
        setBooking(previousBooking);
        setError(message);
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  const assignMeal = (mealId: string) => {
    const target = booking.passengers[activePassengerIdx];
    if (!target) return;
    const previousBooking = booking;

    setError(null);
    setIsBusy(true);
    updatePassengerSelection(target.passengerNo, { mealId });

    void bookingApi
      .assignMeals(booking.pnr, [{ passengerNo: target.passengerNo, mealId }])
      .then(({ booking: next }) => {
        setBooking(next);
      })
      .catch((err) => {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
        setBooking(previousBooking);
        setError(message);
      })
      .finally(() => {
        setIsBusy(false);
      });
  };

  return (
    <section className="container-rams pt-12 pb-24 md:pt-16 md:pb-32">
      <SectionLabel index="06" label="Checkout" />
      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1
          className="font-display leading-[0.96] tracking-[-0.02em]"
          style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
        >
          {booking.pnr}
        </h1>
        <HoldBadge remainingMs={holdRemaining} status={booking.status} />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <Stepper currentStep={step} setStep={setStep} />

          <div className="mt-10 border border-[color:var(--rule)] bg-[color:var(--paper)] p-6 md:p-8">
            {step === "itinerary" && segment && (
              <ItineraryStep booking={booking} segment={segment} />
            )}
            {step === "travellers" && (
              <TravellersStep
                contact={contact}
                setContact={setContact}
                passengers={passengers}
                setPassengers={setPassengers}
              />
            )}
            {step === "seats" && segment && (
              <SeatsAndMealsStep
                booking={booking}
                seatMap={seatMap}
                meals={meals}
                activeIdx={activePassengerIdx}
                setActiveIdx={setActivePassengerIdx}
                onAssignSeat={assignSeat}
                onAssignMeal={assignMeal}
                busy={isBusy}
              />
            )}
            {step === "payment" && (
              <PaymentStep
                payment={payment}
                setPayment={setPayment}
                totalEur={booking.totals.totalEur}
              />
            )}
            {step === "review" && segment && (
              <ReviewStep booking={booking} segment={segment} payment={payment} />
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 border-l-2 border-[color:var(--accent)] bg-[color:var(--paper-2)] px-4 py-3 font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--accent)]"
            >
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              {stepIndex > 0 && step !== "review" && (
                <button type="button" className="btn-ghost" onClick={back}>
                  <span aria-hidden>←</span>
                  <span>Back</span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {step === "itinerary" && (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={advance}
                  disabled={holdExpired}
                >
                  <span>Continue</span>
                  <span aria-hidden>→</span>
                </button>
              )}
              {step === "travellers" && (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={submitTravellers}
                  disabled={isBusy || holdExpired}
                >
                  <span>{isBusy ? "Saving…" : "Continue"}</span>
                  <span aria-hidden>→</span>
                </button>
              )}
              {step === "seats" && (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={submitSeatsAndMeals}
                  disabled={isBusy || holdExpired || !allSeatsPicked || !allMealsPicked}
                >
                  <span>{isBusy ? "Saving…" : "Continue"}</span>
                  <span aria-hidden>→</span>
                </button>
              )}
              {step === "payment" && (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={submitPayment}
                  disabled={isBusy || holdExpired}
                >
                  <span>{isBusy ? "Creating intent…" : "Review"}</span>
                  <span aria-hidden>→</span>
                </button>
              )}
              {step === "review" && (
                <button
                  type="button"
                  className="btn-ink"
                  onClick={confirm}
                  disabled={isBusy || holdExpired}
                >
                  <span>{isBusy ? "Confirming…" : "Confirm reservation"}</span>
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <Summary booking={booking} segment={segment} />
      </div>
    </section>
  );
}

// --- Stepper -----------------------------------------------------------

function Stepper({
  currentStep,
  setStep,
}: {
  currentStep: StepId;
  setStep: (id: StepId) => void;
}) {
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {STEPS.map((step, i) => {
        const isActive = step.id === currentStep;
        const isComplete = i < currentIdx;
        return (
          <button
            key={step.id}
            type="button"
            disabled={i > currentIdx}
            onClick={() => i <= currentIdx && setStep(step.id)}
            className="border p-3 text-left disabled:opacity-50"
            style={{
              borderColor: isActive
                ? "var(--ink)"
                : isComplete
                  ? "var(--signal)"
                  : "var(--rule)",
              background: isActive ? "var(--paper-2)" : "transparent",
              cursor: i <= currentIdx ? "pointer" : "not-allowed",
            }}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="mt-1 block font-display text-[18px] leading-none">
              {step.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- Hold badge ---------------------------------------------------------

function HoldBadge({
  remainingMs,
  status,
}: {
  remainingMs: number | null;
  status: Booking["status"];
}) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-2 border border-[color:var(--signal)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--signal)]">
        <span aria-hidden>✓</span>
        <span>Confirmed</span>
      </span>
    );
  }
  if (remainingMs == null) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
        Draft · no hold window
      </span>
    );
  }
  const expired = remainingMs <= 0;
  const minutes = Math.max(0, Math.floor(remainingMs / 60_000));
  const seconds = Math.max(0, Math.floor((remainingMs % 60_000) / 1000));
  return (
    <span
      className="inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums"
      style={{
        borderColor: expired ? "var(--accent)" : "var(--rule)",
        color: expired ? "var(--accent)" : "var(--ink-soft)",
      }}
    >
      <span aria-hidden className={expired ? "" : "dot-live"} />
      <span>
        {expired
          ? "Hold expired"
          : `Seats held · ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`}
      </span>
    </span>
  );
}

// --- Steps --------------------------------------------------------------

function ItineraryStep({
  booking,
  segment,
}: {
  booking: Booking;
  segment: NonNullable<Booking["segments"][number]>;
}) {
  const dayOffset = dayOffsetBetween(segment.departAt, segment.arriveAt);
  return (
    <div>
      <p className="eyebrow">Itinerary</p>
      <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.02em]">
        {segment.from.city} → {segment.to.city}
      </h2>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
        {segment.flightNo} · {segment.aircraft} · {CABIN_NAMES[segment.cabin]}
      </p>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
        <Pair
          label="Depart"
          big={formatClockInZone(segment.departAt, "UTC")}
          sub={`${segment.from.iata} · ${formatTravelDate(segment.departAt)}`}
        />
        <Pair
          label="Arrive"
          big={
            <>
              {formatClockInZone(segment.arriveAt, "UTC")}
              {dayOffset > 0 && (
                <sup className="ml-1 align-super font-mono text-[14px] tracking-normal text-[color:var(--ink-soft)]">
                  +{dayOffset}
                </sup>
              )}
            </>
          }
          sub={`${segment.to.iata} · ${formatDuration(segment.durationMin)}`}
        />
      </div>

      <p className="mt-8 max-w-[60ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
        We've held {booking.pax} {booking.pax === 1 ? "seat" : "seats"} in{" "}
        {CABIN_NAMES[segment.cabin]} for ten minutes while you finish. No
        commitment until you confirm payment.
      </p>
    </div>
  );
}

function TravellersStep({
  contact,
  setContact,
  passengers,
  setPassengers,
}: {
  contact: ContactDraft;
  setContact: (c: ContactDraft) => void;
  passengers: PassengerDraft[];
  setPassengers: (p: PassengerDraft[]) => void;
}) {
  return (
    <div>
      <p className="eyebrow">Travellers</p>
      <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.02em]">
        Who is travelling?
      </h2>
      <p className="mt-2 max-w-[58ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
        Names as they appear on the passport. The lead contact receives the
        booking record and any schedule updates.
      </p>

      <fieldset className="mt-8">
        <legend className="eyebrow">Lead contact</legend>
        <div className="mt-3 grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
          <Input
            label="Full name"
            value={contact.name}
            onChange={(v) => setContact({ ...contact, name: v })}
            placeholder="Jane Voss"
          />
          <Input
            label="Email"
            type="email"
            value={contact.email}
            onChange={(v) => setContact({ ...contact, email: v })}
            placeholder="jane@voss.studio"
          />
          <Input
            label="Phone"
            value={contact.phone}
            onChange={(v) => setContact({ ...contact, phone: v })}
            placeholder="+44 20 7946 0920"
          />
        </div>
      </fieldset>

      {passengers.map((passenger, idx) => (
        <fieldset
          key={passenger.passengerNo}
          className="mt-8 border-t border-[color:var(--rule)] pt-8"
        >
          <legend className="eyebrow">Passenger {passenger.passengerNo}</legend>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Input
              label="Given name"
              value={passenger.givenName}
              onChange={(v) => {
                const copy = [...passengers];
                copy[idx] = { ...passenger, givenName: v };
                setPassengers(copy);
              }}
            />
            <Input
              label="Family name"
              value={passenger.familyName}
              onChange={(v) => {
                const copy = [...passengers];
                copy[idx] = { ...passenger, familyName: v };
                setPassengers(copy);
              }}
            />
            <Input
              label="Frequent flyer"
              value={passenger.loyaltyNo}
              onChange={(v) => {
                const copy = [...passengers];
                copy[idx] = { ...passenger, loyaltyNo: v };
                setPassengers(copy);
              }}
              placeholder="Optional programme number"
            />
            <Input
              label="Service notes"
              value={passenger.notes}
              onChange={(v) => {
                const copy = [...passengers];
                copy[idx] = { ...passenger, notes: v };
                setPassengers(copy);
              }}
              placeholder="Dietary or accessibility notes"
            />
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function SeatsAndMealsStep({
  booking,
  seatMap,
  meals,
  activeIdx,
  setActiveIdx,
  onAssignSeat,
  onAssignMeal,
  busy,
}: {
  booking: Booking;
  seatMap: SeatMap | null;
  meals: typeof MEAL_CATALOG;
  activeIdx: number;
  setActiveIdx: (idx: number) => void;
  onAssignSeat: (seatId: string | null) => void;
  onAssignMeal: (mealId: string) => void;
  busy: boolean;
}) {
  const activePassenger = booking.passengers[activeIdx];
  if (!seatMap) {
    return (
      <div>
        <p className="eyebrow">Seats + meals</p>
        <p className="mt-4 text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
          The seat map for this flight is temporarily unavailable. Try again
          in a moment.
        </p>
      </div>
    );
  }

  const seatByKey = new Map(seatMap.seats.map((seat) => [seat.seatId, seat]));
  const columnSet = new Set<string>();
  for (const row of seatMap.layout.rows) {
    for (const col of row.columns) {
      columnSet.add(col);
    }
  }
  const columns = [...columnSet].sort();
  const otherAssignedSeats = new Set(
    booking.passengers
      .filter((_, idx) => idx !== activeIdx)
      .map((p) => p.seatId)
      .filter(Boolean) as string[],
  );

  return (
    <div>
      <p className="eyebrow">Seats + meals</p>
      <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.02em]">
        Pick a seat, then a meal.
      </h2>

      <div className="mt-6 flex flex-wrap gap-2" role="tablist">
        {booking.passengers.map((passenger, idx) => {
          const isActive = idx === activeIdx;
          const label = `${passenger.givenName} ${passenger.familyName}`.trim() || `P${passenger.passengerNo}`;
          return (
            <button
              key={passenger.passengerNo}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveIdx(idx)}
              className="border px-4 py-3 text-left"
              style={{
                borderColor: isActive ? "var(--ink)" : "var(--rule)",
                background: isActive ? "var(--paper-2)" : "transparent",
              }}
            >
              <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                P{passenger.passengerNo}
              </span>
              <span className="mt-1 block font-display text-[20px] leading-none tracking-[-0.01em]">
                {label}
              </span>
              <span className="mt-2 block font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-mute)]">
                {passenger.seatId ?? "Seat pending"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 p-6">
          <div className="mx-auto inline-block">
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `auto repeat(${columns.length}, 40px)`,
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
              {seatMap.layout.rows.map((row) => (
                <SeatPickerRow
                  key={row.row}
                  rowNo={row.row}
                  zone={row.zone}
                  columns={columns}
                  rowColumns={row.columns}
                  seatByKey={seatByKey}
                  activeSeatId={activePassenger?.seatId ?? null}
                  otherAssigned={otherAssignedSeats}
                  busy={busy}
                  onPick={(seatId) => {
                    if (activePassenger?.seatId === seatId) {
                      onAssignSeat(null);
                    } else {
                      onAssignSeat(seatId);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          <p className="eyebrow">Dining plan</p>
          <p className="mt-2 max-w-[40ch] text-[13px] leading-[1.55] text-[color:var(--ink-soft)]">
            Selections are saved per traveller and can be changed up to 24h
            before departure.
          </p>
          <div className="mt-4 grid gap-3">
            {meals.map((meal) => {
              const isSelected = activePassenger?.mealId === meal.id;
              return (
                <button
                  key={meal.id}
                  type="button"
                  onClick={() => onAssignMeal(meal.id)}
                  disabled={busy}
                  className="border p-4 text-left"
                  style={{
                    borderColor: isSelected ? "var(--ink)" : "var(--rule)",
                    background: isSelected ? "var(--paper-2)" : "var(--paper)",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-display text-[20px] leading-none tracking-[-0.01em]">
                      {meal.name}
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                      {meal.priceEur === 0 ? "Included" : `+${formatFare(meal.priceEur)}`}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] leading-[1.55] text-[color:var(--ink-soft)]">
                    {meal.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeatPickerRow({
  rowNo,
  zone,
  columns,
  rowColumns,
  seatByKey,
  activeSeatId,
  otherAssigned,
  busy,
  onPick,
}: {
  rowNo: number;
  zone: string;
  columns: string[];
  rowColumns: string[];
  seatByKey: Map<string, SeatMap["seats"][number]>;
  activeSeatId: string | null;
  otherAssigned: Set<string>;
  busy: boolean;
  onPick: (seatId: string) => void;
}) {
  return (
    <>
      <div className="flex items-center pr-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
        {rowNo}
      </div>
      {columns.map((col) => {
        if (!rowColumns.includes(col)) {
          return <div key={`${rowNo}-${col}-x`} aria-hidden />;
        }
        const seatId = `${rowNo}${col}`;
        const seat = seatByKey.get(seatId);
        const status = seat?.status ?? "available";
        const claimedByOther = otherAssigned.has(seatId);
        const isMine = activeSeatId === seatId;
        const disabled =
          busy ||
          (status === "taken" && !isMine) ||
          (status === "blocked" && !isMine) ||
          claimedByOther;
        return (
          <button
            key={seatId}
            type="button"
            disabled={disabled}
            onClick={() => onPick(seatId)}
            title={`${seatId} · ${zone}${seat?.priceEur ? ` · +€${seat.priceEur}` : ""}`}
            className="flex h-10 w-10 items-center justify-center border text-[11px] font-mono tabular-nums disabled:cursor-not-allowed"
            style={{
              borderColor: isMine
                ? "var(--ink)"
                : claimedByOther || status === "taken"
                  ? "var(--ink-mute)"
                  : status === "held"
                    ? "var(--accent)"
                    : "var(--rule)",
              background: isMine
                ? "var(--accent)"
                : claimedByOther || status === "taken"
                  ? "var(--ink-mute)"
                  : "var(--paper)",
              color: isMine || claimedByOther || status === "taken" ? "var(--paper)" : "var(--ink)",
            }}
          >
            {col}
          </button>
        );
      })}
    </>
  );
}

function PaymentStep({
  payment,
  setPayment,
  totalEur,
}: {
  payment: PaymentDraft;
  setPayment: (p: PaymentDraft) => void;
  totalEur: number;
}) {
  return (
    <div>
      <p className="eyebrow">Payment</p>
      <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.02em]">
        Charge preview · {formatFare(totalEur)}
      </h2>
      <p className="mt-2 max-w-[58ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
        Demonstration checkout. Card details stay in this browser; no real
        payment is taken.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Input
          label="Cardholder"
          value={payment.cardholder}
          onChange={(v) => setPayment({ ...payment, cardholder: v })}
        />
        <Input
          label="Country"
          value={payment.country}
          onChange={(v) => setPayment({ ...payment, country: v })}
        />
        <Input
          label="Card number"
          mono
          value={payment.cardNumber}
          onChange={(v) => setPayment({ ...payment, cardNumber: v })}
          placeholder="4242 4242 4242 4242"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Expiry"
            mono
            value={payment.expiry}
            onChange={(v) => setPayment({ ...payment, expiry: v })}
            placeholder="MM/YY"
          />
          <Input
            label="CVC"
            mono
            value={payment.cvc}
            onChange={(v) => setPayment({ ...payment, cvc: v })}
            placeholder="242"
          />
        </div>
      </div>

      <div className="mt-8 space-y-3 border-t border-[color:var(--rule)] pt-6 text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
        <label className="flex gap-3">
          <input
            type="checkbox"
            checked={payment.agreeToPreview}
            onChange={(e) =>
              setPayment({ ...payment, agreeToPreview: e.target.checked })
            }
          />
          <span>
            This is a demonstration checkout only. Card details stay in local
            browser state and are never transmitted.
          </span>
        </label>
        <label className="flex gap-3">
          <input
            type="checkbox"
            checked={payment.agreeToTerms}
            onChange={(e) =>
              setPayment({ ...payment, agreeToTerms: e.target.checked })
            }
          />
          <span>
            Fare rules, baggage allowance, and seat assignments reflect what a
            live booking would show once connected to our reservation system.
          </span>
        </label>
      </div>
    </div>
  );
}

function ReviewStep({
  booking,
  segment,
  payment,
}: {
  booking: Booking;
  segment: NonNullable<Booking["segments"][number]>;
  payment: PaymentDraft;
}) {
  return (
    <div>
      <p className="eyebrow">Review</p>
      <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.02em]">
        Confirm your reservation.
      </h2>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <ReviewBlock
          title="Journey"
          rows={[
            { k: "Flight", v: segment.flightNo },
            { k: "Route", v: `${segment.from.iata} → ${segment.to.iata}` },
            {
              k: "Depart",
              v: `${formatTravelDate(segment.departAt)} · ${formatClockInZone(segment.departAt, "UTC")}`,
            },
            {
              k: "Arrive",
              v: `${formatClockInZone(segment.arriveAt, "UTC")}`,
            },
            { k: "Cabin", v: CABIN_NAMES[segment.cabin] },
          ]}
        />
        <ReviewBlock
          title="Contact"
          rows={[
            { k: "Lead", v: booking.contact.name ?? "—" },
            { k: "Email", v: booking.contact.email ?? "—" },
            { k: "Phone", v: booking.contact.phone ?? "—" },
            { k: "Passengers", v: String(booking.pax) },
            { k: "Total", v: formatFare(booking.totals.totalEur) },
          ]}
        />
      </div>

      <p className="mt-8 max-w-[60ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
        Charging {formatFare(booking.totals.totalEur)} to the card ending in{" "}
        <span className="font-mono">
          {payment.cardNumber.replace(/\D/g, "").slice(-4) || "••••"}
        </span>
        . Press confirm to issue your PNR.
      </p>
    </div>
  );
}

// --- Summary -----------------------------------------------------------

function Summary({
  booking,
  segment,
}: {
  booking: Booking;
  segment?: Booking["segments"][number];
}) {
  return (
    <aside aria-label="Reservation summary">
      <div className="sticky top-24 border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40">
        <div className="flex items-center justify-between border-b border-[color:var(--rule)] px-5 py-3">
          <span className="eyebrow">Reservation · draft</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums">
            {booking.pnr}
          </span>
        </div>

        {segment && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4 px-5 pt-6">
            <div>
              <div className="eyebrow">From</div>
              <div className="mt-1 font-display text-[40px] leading-none tracking-[-0.02em] tabular-nums">
                {segment.from.iata}
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[color:var(--ink-soft)]">
                {segment.from.city}
              </div>
            </div>
            <div className="pb-1 text-[color:var(--ink-mute)]" aria-hidden>
              ✈
            </div>
            <div className="text-right">
              <div className="eyebrow">To</div>
              <div className="mt-1 font-display text-[40px] leading-none tracking-[-0.02em] tabular-nums">
                {segment.to.iata}
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[color:var(--ink-soft)]">
                {segment.to.city}
              </div>
            </div>
          </div>
        )}

        {segment && (
          <dl className="px-5 py-4 font-mono text-[12px]">
            <SummaryRow k="Flight" v={segment.flightNo} />
            <SummaryRow
              k="Depart"
              v={`${formatTravelDate(segment.departAt)} · ${formatClockInZone(segment.departAt, "UTC")}`}
            />
            <SummaryRow k="Duration" v={formatDuration(segment.durationMin)} />
            <SummaryRow k="Cabin" v={`${segment.cabin} · ${CABIN_NAMES[segment.cabin]}`} />
            <SummaryRow k="Passengers" v={String(booking.pax)} />
          </dl>
        )}

        <div className="border-t border-[color:var(--rule)] px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Total</span>
            <span className="font-display text-[28px] leading-none tabular-nums">
              {formatFare(booking.totals.totalEur)}
            </span>
          </div>
          <div className="mt-4 font-mono text-[12px]">
            <SummaryRow k="Fare" v={formatFare(booking.totals.baseEur)} />
            <SummaryRow k="Seats" v={formatFare(booking.totals.seatsEur)} />
            <SummaryRow k="Dining" v={formatFare(booking.totals.mealsEur)} />
            <SummaryRow k="Taxes" v={formatFare(booking.totals.taxesEur)} />
            <SummaryRow k="Surface" v={formatFare(booking.totals.surfaceEur)} />
          </div>
          <p className="mt-4 text-[11px] leading-[1.55] text-[color:var(--ink-mute)]">
            Demonstration checkout. Mirrors a live booking but no payment is
            processed.
          </p>
        </div>
      </div>
    </aside>
  );
}

// --- Inputs & utilities -------------------------------------------------

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2 border border-[color:var(--rule)] bg-[color:var(--paper)] px-4 py-3">
      <span className="eyebrow">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`bg-transparent border-none outline-none text-[20px] leading-[1.2] ${mono ? "font-mono tabular-nums" : "font-display"}`}
        style={{ letterSpacing: "-0.01em" }}
      />
    </label>
  );
}

function Pair({
  label,
  big,
  sub,
}: {
  label: string;
  big: React.ReactNode;
  sub: string;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-3 font-display text-[44px] leading-none tracking-[-0.02em] tabular-nums">
        {big}
      </p>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
        {sub}
      </p>
    </div>
  );
}

function ReviewBlock({
  title,
  rows,
}: {
  title: string;
  rows: { k: string; v: string }[];
}) {
  return (
    <div className="border border-[color:var(--rule)] bg-[color:var(--paper)] px-5 py-4">
      <p className="eyebrow">{title}</p>
      <div className="mt-4 font-mono text-[12px]">
        {rows.map((row) => (
          <SummaryRow key={row.k} k={row.k} v={row.v} />
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-[10px] uppercase tracking-[0.1em] text-[color:var(--ink-mute)]">
        {k}
      </dt>
      <dd className="tabular-nums text-right text-[color:var(--ink)]">{v}</dd>
    </div>
  );
}
