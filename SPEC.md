# FlyLo Booking · Frontend Spec

A Next.js 16 app that mirrors the FlyLo marketing site's visual language
and serves as the real booking product. Talks to `booking-backend` over
HTTP.

## Stack

- **Next.js 16** (App Router, React 19, Turbopack)
- **Tailwind CSS v4** — CSS-first via `@theme` in `src/app/globals.css`
- **next/font** — Instrument Serif (display) + Geist (sans) + Geist Mono (data)
- No UI kit, no animation libraries, no state library
- A small typed API client in `src/lib/api.ts` wraps `fetch` calls to
  `booking-backend`
- A browser session UUID (in `localStorage`) is sent on every API
  request via `x-booking-session` so bookings persist without auth

## Design system

Verbatim port of `flylo-air/web`:

- Tokens in `:root` (`--paper`, `--ink`, `--accent`, `--signal`, …)
- Typography (Instrument Serif display, Geist body, Geist Mono data)
- UI primitives (`Rule`, `SectionLabel`, `DataRow`, `eyebrow`, `btn-ink`, `btn-ghost`)
- `Header`, `Footer`, `Marquee` adapted for the app context (slimmer
  header with a "Back to flylo.air" link)

## Environment

| Var | Used by |
|---|---|
| `BOOKING_API_URL` | server-side fetches to the backend |
| `NEXT_PUBLIC_BOOKING_API_URL` | client-side fetches |
| `NEXT_PUBLIC_MARKETING_URL` | back-link in the header (default `https://www.flylo.air`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase (reserved for future realtime) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (reserved for future realtime) |

## Routes

| Path | Purpose |
|---|---|
| `/` | Search hero (expanded BookingStrip) + trending destinations + popular routes |
| `/search` | Results list with faceted filters and price-per-day strip |
| `/flights/[id]` | Flight detail with cabin chooser and seat-map preview |
| `/book/[pnr]` | 5-step checkout: itinerary → passengers → seats + meals → payment → review |
| `/book/[pnr]/confirmation` | Boarding-pass-style confirmation |
| `/trips` | List trips owned by this browser session + PNR + email lookup |
| `/trips/[pnr]` | Trip detail |
| `/legal/privacy`, `/legal/terms` | Reused from marketing site |

## Build order

This repo ships in phases, each its own PR:

1. **Foundation** (this PR): tokens, fonts, layout, Header/Footer/Marquee, API client, home page wired to backend.
2. **Search & detail**: `/search` and `/flights/[id]`.
3. **Checkout**: `/book/[pnr]` 5-step flow, server-backed.
4. **Trips**: `/trips`, `/trips/[pnr]`, guest lookup.
5. **Polish**: loading/error/empty states, OG image, SEO, accessibility audit.

## Build & run

```bash
npm install
npm run dev           # http://localhost:3000
npm run build
npm start
```

The backend needs to be running on `BOOKING_API_URL` (defaults to
`http://localhost:8787` in dev).
