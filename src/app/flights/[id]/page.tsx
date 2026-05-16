import Link from "next/link";
import type { Metadata } from "next";
import { SectionLabel } from "@/components/ui/SectionLabel";

export const metadata: Metadata = {
  title: "Flight detail",
};

type Params = Promise<{ id: string }>;

export default async function FlightDetailPage({
  params,
}: {
  params: Params;
}) {
  const { id } = await params;

  return (
    <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
      <SectionLabel index="03" label="Flight" />
      <h1
        className="mt-6 font-display leading-[0.96] tracking-[-0.02em]"
        style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
      >
        Selected.
      </h1>
      <p className="mt-6 max-w-[58ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)]">
        Flight detail with cabin chooser, seat-map preview, and a 5-step
        checkout flow lands in the next iteration. The chosen flight's id is{" "}
        <code className="font-mono text-[12px] text-[color:var(--ink)]">{id}</code>.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/" className="btn-ghost">
          <span aria-hidden>←</span>
          <span>Back to search</span>
        </Link>
      </div>
    </section>
  );
}
