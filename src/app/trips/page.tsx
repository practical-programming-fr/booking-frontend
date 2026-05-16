import type { Metadata } from "next";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Trips",
};

export default function TripsPage() {
  return (
    <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
      <SectionLabel index="04" label="Trips" />
      <h1
        className="mt-6 font-display leading-[0.96] tracking-[-0.02em]"
        style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
      >
        Manage a trip.
      </h1>
      <p className="mt-6 max-w-[58ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
        Trip lookup by PNR + email and the per-trip detail view land in a
        later iteration alongside the write-side endpoints. For now you can
        head back to the network search and explore the catalog.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/" className="btn-ink">
          <span>Search flights</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}
