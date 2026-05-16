import Link from "next/link";
import { Logo } from "./Logo";
import { footerNav, site } from "@/data/site";
import { Rule } from "@/components/ui/Rule";

export function Footer() {
  return (
    <footer className="mt-32 border-t border-[color:var(--rule)] bg-[color:var(--paper-2)]">
      <div className="container-rams py-16">
        <div className="grid-12 gap-y-12">
          <div className="col-span-12 md:col-span-4">
            <Logo />
            <p
              className="mt-6 max-w-[34ch] font-display text-[22px] leading-[1.2] text-[color:var(--ink)]"
              style={{ letterSpacing: "-0.01em" }}
            >
              Reserve a seat across the FlyLo network — Atlas Suite to Linen,
              every continent, fares that include the things that used to cost
              extra.
            </p>
            <div className="mt-8 flex items-center gap-3">
              <Link href="/" className="btn-ink">
                <span>Search flights</span>
                <span aria-hidden>→</span>
              </Link>
              <a
                href={site.marketingUrl}
                className="btn-ghost"
              >
                <span>flylo-air.com</span>
                <span aria-hidden>→</span>
              </a>
            </div>
            <p className="mt-8 max-w-[40ch] font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
              Guest Care &amp; reservations · daily 06:00–22:00 PT
            </p>
          </div>

          {footerNav.map((column) => (
            <div key={column.heading} className="col-span-6 md:col-span-2">
              <h3 className="eyebrow">{column.heading}</h3>
              <ul className="mt-5 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("http") || link.href.startsWith("mailto:") || link.href.startsWith("tel:") ? (
                      <a
                        href={link.href}
                        className="link-rule text-[13px] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="link-rule text-[13px] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Rule className="mt-16" />

        <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <dl className="flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
            <div className="flex items-center gap-2">
              <dt className="text-[color:var(--ink-mute)]">IATA</dt>
              <dd>{site.iata}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-[color:var(--ink-mute)]">ICAO</dt>
              <dd>{site.icao}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-[color:var(--ink-mute)]">Surface</dt>
              <dd>Booking · v0.1</dd>
            </div>
          </dl>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
            © {site.year} {site.longName} · {site.product}
          </p>
        </div>
      </div>
    </footer>
  );
}
