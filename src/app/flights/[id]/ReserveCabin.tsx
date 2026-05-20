"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookingApi, ApiError } from "@/lib/api";

type Props = {
  flightId: string;
  cabin: "A" | "P" | "L";
  pax: number;
  disabled?: boolean;
  label: string;
};

export function ReserveCabin({ flightId, cabin, pax, disabled, label }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reserve = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { booking } = await bookingApi.createBooking({
          flightId,
          cabin,
          pax,
        });
        router.push(`/book/${booking.pnr}`);
        router.refresh();
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="btn-ink justify-center"
        onClick={reserve}
        disabled={disabled || isPending}
      >
        <span>{isPending ? "Holding a seat…" : label}</span>
        <span aria-hidden>{isPending ? "•" : "→"}</span>
      </button>
      {error && (
        <p
          role="alert"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--accent)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
