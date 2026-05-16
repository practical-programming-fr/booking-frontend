import Link from "next/link";
import { Logo } from "./Logo";
import { nav, site } from "@/data/site";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--rule)] bg-[color:var(--paper)]/85 backdrop-blur-[6px] supports-[backdrop-filter]:bg-[color:var(--paper)]/70">
      <div className="container-rams flex h-16 items-center justify-between gap-8">
        <Logo />

        <nav
          aria-label="Primary"
          className="hidden items-center gap-7 md:flex"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="link-rule font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href={site.marketingUrl}
            className="link-rule hidden font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)] sm:inline-flex"
          >
            <span aria-hidden className="mr-1">←</span>
            <span>flylo.air</span>
          </a>
          <Link href="/trips" className="btn-ghost hidden sm:inline-flex">
            <span>Find a trip</span>
          </Link>
          <Link href="/" className="btn-ink">
            <span>Search</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
