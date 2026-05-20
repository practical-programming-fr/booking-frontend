import Link from "next/link";

type Props = {
  compact?: boolean;
};

/**
 * FLYLO lockup — serif wordmark with a single accent dot. The booking app's
 * variant labels the lockup "Booking" instead of the marketing site's
 * "Airlines" so it's obvious which surface you're on.
 */
export function Logo({ compact = false }: Props) {
  return (
    <Link
      href="/"
      className="group inline-flex items-baseline gap-2 text-[color:var(--ink)]"
      aria-label="FlyLo Booking — home"
    >
      <span
        className="font-display leading-none tracking-[-0.02em]"
        style={{ fontSize: compact ? "22px" : "26px" }}
      >
        FlyLo
      </span>
      <span
        aria-hidden
        className="inline-block h-[6px] w-[6px] rounded-full"
        style={{ background: "var(--accent)" }}
      />
      {!compact && (
        <span className="eyebrow hidden sm:inline-block">Booking</span>
      )}
    </Link>
  );
}
