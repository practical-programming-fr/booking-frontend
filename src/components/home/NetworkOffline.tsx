import { site } from "@/data/site";

type Props = {
  error: string;
};

/**
 * Rendered when the home page can't reach the backend. We want this to look
 * like a thoughtful empty state, not a stack trace.
 */
export function NetworkOffline({ error }: Props) {
  return (
    <section className="container-rams py-16 md:py-24">
      <div className="border border-[color:var(--rule)] bg-[color:var(--paper-2)]/40 px-6 py-8 md:px-10 md:py-12">
        <p className="eyebrow">Atlas · offline</p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.02] tracking-[-0.02em] md:text-[48px]">
          The reservations network is unreachable from this preview.
        </h2>
        <p className="mt-5 max-w-[64ch] text-[14px] leading-[1.6] text-[color:var(--ink-soft)]">
          The booking-frontend talks to a separate booking-backend service for
          live inventory. Start it locally with{" "}
          <code className="font-mono text-[12px] text-[color:var(--ink)]">npm run dev</code>{" "}
          in the <code className="font-mono text-[12px] text-[color:var(--ink)]">booking-backend</code> repo, or set
          <code className="font-mono text-[12px] text-[color:var(--ink)]"> BOOKING_API_URL</code> to a deployed instance.
        </p>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-mute)]">
          {error}
        </p>
        <div className="mt-8 flex gap-3">
          <a href={site.marketingUrl} className="btn-ghost">
            <span>flylo-air.com</span>
          </a>
        </div>
      </div>
    </section>
  );
}
