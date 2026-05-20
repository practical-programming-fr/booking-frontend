"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getLocalDateInputValue,
  getRelativeLocalDateInputValue,
} from "@/lib/date-input";

type AirportOption = {
  iata: string;
  city: string;
  country: string;
  isHub: boolean;
};

type Props = {
  airports: AirportOption[];
};

const cabins = [
  { code: "A" as const, name: "Atlas Suite" },
  { code: "P" as const, name: "Prospect" },
  { code: "L" as const, name: "Linen" },
];

function defaultDate(): string {
  return getRelativeLocalDateInputValue(21);
}

export function SearchHero({ airports }: Props) {
  const router = useRouter();
  const hubs = airports.filter((airport) => airport.isHub);
  const spokes = airports.filter((airport) => !airport.isHub);
  const defaultFrom = hubs[0]?.iata ?? airports[0]?.iata ?? "LHR";
  const defaultTo =
    spokes.find((airport) => airport.iata === "HND")?.iata ??
    spokes[0]?.iata ??
    "JFK";

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [date, setDate] = useState(defaultDate());
  const [cabin, setCabin] = useState<"A" | "P" | "L">("L");
  const [pax, setPax] = useState(1);
  const [minDate, setMinDate] = useState("");

  useEffect(() => {
    setMinDate(getLocalDateInputValue());
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams({
      from,
      to,
      date,
      cabin,
      pax: String(pax),
    });
    router.push(`/search?${params.toString()}`);
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mt-12 grid grid-cols-1 items-stretch border border-[color:var(--ink)] bg-[color:var(--paper-2)]/40 md:grid-cols-[1.2fr_auto_1.2fr_1fr_1fr_0.7fr_auto]"
      aria-label="Search FlyLo flights"
    >
      <Field label="From">
        <select
          className="hero-input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          {hubs.length > 0 && (
            <optgroup label="Hubs">
              {hubs.map((airport) => (
                <option key={airport.iata} value={airport.iata}>
                  {airport.iata} · {airport.city}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All airports">
            {spokes.map((airport) => (
              <option key={airport.iata} value={airport.iata}>
                {airport.iata} · {airport.city}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      <button
        type="button"
        onClick={swap}
        aria-label="Swap origin and destination"
        className="hero-swap"
      >
        <span aria-hidden>↔</span>
      </button>

      <Field label="To">
        <select
          className="hero-input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          {hubs.length > 0 && (
            <optgroup label="Hubs">
              {hubs.map((airport) => (
                <option key={airport.iata} value={airport.iata}>
                  {airport.iata} · {airport.city}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All airports">
            {spokes.map((airport) => (
              <option key={airport.iata} value={airport.iata}>
                {airport.iata} · {airport.city}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>

      <Field label="Depart">
        <input
          type="date"
          className="hero-input"
          value={date}
          min={minDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>

      <Field label="Cabin">
        <select
          className="hero-input"
          value={cabin}
          onChange={(e) => setCabin(e.target.value as "A" | "P" | "L")}
        >
          {cabins.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.code} · {entry.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Pax">
        <input
          type="number"
          min={1}
          max={9}
          className="hero-input tabular-nums"
          value={pax}
          onChange={(e) =>
            setPax(Math.max(1, Math.min(9, Number(e.target.value) || 1)))
          }
        />
      </Field>

      <button type="submit" className="btn-ink h-full justify-center px-8">
        <span>Search</span>
        <span aria-hidden>→</span>
      </button>

      <style>{`
        .hero-input {
          width: 100%;
          height: 100%;
          min-height: 76px;
          padding: 0;
          background: transparent;
          color: var(--ink);
          font-family: var(--font-display);
          font-size: 24px;
          line-height: 1.1;
          letter-spacing: -0.01em;
          border: none;
          outline: none;
          appearance: none;
        }
        .hero-input::-webkit-calendar-picker-indicator {
          filter: contrast(0.6);
          opacity: 0.55;
          cursor: pointer;
        }
        .hero-swap {
          display: none;
          align-items: center;
          justify-content: center;
          width: 38px;
          color: var(--ink-soft);
          background: transparent;
          border: none;
          border-right: 1px solid var(--rule);
          cursor: pointer;
          transition: color 200ms var(--ease);
        }
        .hero-swap:hover, .hero-swap:focus-visible {
          color: var(--ink);
        }
        @media (min-width: 768px) {
          .hero-swap { display: flex; }
        }
      `}</style>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="group flex flex-col gap-2 border-b border-[color:var(--rule)] px-6 py-5 md:border-b-0 md:border-r md:last:border-r-0">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}
