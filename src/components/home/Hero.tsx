import { SectionLabel } from "@/components/ui/SectionLabel";
import { SearchHero } from "./SearchHero";
import type { Airport } from "@/lib/api";

type Props = {
  airports: Airport[];
};

export function Hero({ airports }: Props) {
  return (
    <section
      aria-labelledby="hero-heading"
      className="container-rams pt-16 pb-12 md:pt-24 md:pb-20"
    >
      <SectionLabel index="01" label="Reserve" />

      <h1
        id="hero-heading"
        className="mt-6 font-display leading-[0.94] tracking-[-0.025em]"
        style={{ fontSize: "clamp(48px, 9vw, 132px)" }}
      >
        Choose a seat.
        <span className="block italic text-[color:var(--ink-soft)]">
          From anywhere to anywhere.
        </span>
      </h1>

      <p className="mt-7 max-w-[58ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)] md:text-[17px]">
        Search the live network, hold a seat for ten minutes, and confirm
        without a sign-up wall. Atlas Suite to Linen — one fare published, no
        add-ons at the gate.
      </p>

      <SearchHero
        airports={airports.map((airport) => ({
          iata: airport.iata,
          city: airport.city,
          country: airport.country,
          isHub: airport.isHub,
        }))}
      />
    </section>
  );
}
