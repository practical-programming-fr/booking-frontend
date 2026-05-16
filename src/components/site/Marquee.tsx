import { Fragment } from "react";

const tickerItems: { code: string; route: string; status: string }[] = [
  { code: "FL 042", route: "LHR → SFO", status: "ON TIME · BOARDING 18:20" },
  { code: "FL 007", route: "LHR → HND", status: "ON TIME · GATE 4 · 21:35" },
  { code: "FL 142", route: "SFO → JFK", status: "ON TIME · GATE A24" },
  { code: "FL 221", route: "SFO → SIN", status: "CRUISING · 39,000 FT" },
  { code: "FL 318", route: "LHR → DXB", status: "ON TIME · 06H 12M" },
  { code: "FL 406", route: "SFO → GRU", status: "EN ROUTE · 1.02 GBPS" },
  { code: "FL 512", route: "LHR → AMS", status: "FINAL CALL · GATE B08" },
  { code: "FL 633", route: "SFO → CDG", status: "ON TIME · GATE K14" },
  { code: "FL 701", route: "LHR → SYD", status: "CRUISING · 41,000 FT" },
];

/**
 * Thin top strip — flight numbers scrolling past, like a departures board.
 * CSS-only, no JS. Doubled content for seamless loop. In a later iteration
 * this can be wired to a live API feed via `GET /v1/flights/board`.
 */
export function Marquee() {
  const track = (
    <div className="flex items-center gap-12 pr-12">
      {tickerItems.map((item, i) => (
        <span
          key={`${item.code}-${i}`}
          className="inline-flex items-center gap-3 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-soft)]"
        >
          <span className="text-[color:var(--ink)]">{item.code}</span>
          <span aria-hidden className="text-[color:var(--ink-mute)]">·</span>
          <span>{item.route}</span>
          <span aria-hidden className="text-[color:var(--ink-mute)]">·</span>
          <span>{item.status}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="marquee-wrap relative flex h-9 items-center overflow-hidden border-b border-[color:var(--rule)]"
      style={{ background: "var(--paper-2)" }}
    >
      <span className="eyebrow absolute left-0 z-10 hidden h-full items-center gap-2 border-r border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 sm:flex">
        <span className="dot-live" />
        LIVE · FLYLO ATLAS
      </span>
      <div
        className="marquee-track pl-4 sm:pl-[220px]"
        aria-label="Live FlyLo flight status ticker"
      >
        <Fragment>
          {track}
          {track}
        </Fragment>
      </div>
    </div>
  );
}
