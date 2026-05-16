import type { Metadata } from "next";
import Link from "next/link";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { site } from "@/data/site";

export const metadata: Metadata = {
  title: "Help",
};

export default function HelpPage() {
  return (
    <section className="container-rams pt-16 pb-24 md:pt-24 md:pb-32">
      <SectionLabel index="05" label="Help" />
      <h1
        className="mt-6 font-display leading-[0.96] tracking-[-0.02em]"
        style={{ fontSize: "clamp(40px, 7vw, 96px)" }}
      >
        We're here.
      </h1>

      <div className="mt-12 grid gap-8 md:grid-cols-2">
        <div className="border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 p-6">
          <p className="eyebrow">Guest Care</p>
          <p className="mt-4 font-display text-[28px] leading-[1.05] tracking-[-0.02em]">
            Daily 06:00–22:00 PT
          </p>
          <ul className="mt-6 space-y-2 font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
            <li>
              <a href="tel:+14155800707" className="link-rule">+1 (415) 580-0707</a>
            </li>
            <li>
              <a href="mailto:contact@flylo-air.com" className="link-rule">contact@flylo-air.com</a>
            </li>
          </ul>
        </div>

        <div className="border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 p-6">
          <p className="eyebrow">About FlyLo</p>
          <p className="mt-4 max-w-[44ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
            Cabin specs, network, sustainability, and editorial pieces live on
            the marketing site.
          </p>
          <div className="mt-6">
            <a href={site.marketingUrl} className="btn-ghost">
              <span>flylo-air.com</span>
              <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <Link href="/" className="btn-ink">
          <span>Search flights</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}
