# FlyLo Booking · Frontend

The real booking product for FlyLo Airlines. Built in the same visual
language as the marketing site at [flylo-air.com](https://www.flylo-air.com),
served separately so it can ship at its own cadence and talk to the
booking-backend API.

See [`SPEC.md`](./SPEC.md) for the route inventory and the build plan.

## Stack

- **Next.js 16** (App Router, React 19, Turbopack)
- **Tailwind CSS v4** — CSS-first config in `src/app/globals.css`
- **next/font** — Instrument Serif + Geist + Geist Mono
- No UI kit, no animation library, no state library
- A tiny typed API client in `src/lib/api.ts` wraps the booking-backend
- A browser session UUID kept in `localStorage` so bookings persist
  without authentication

## Quick start

```bash
cp .env.example .env.local
# point BOOKING_API_URL / NEXT_PUBLIC_BOOKING_API_URL at the running backend
npm install
npm run dev
# → http://localhost:3000
```

The home page hits `GET /v1/airports` and `GET /v1/routes` on the
backend. If the backend isn't reachable, the page renders a graceful
"network offline" panel.

## Routes

| Path | Purpose | Status |
|---|---|---|
| `/` | Search hero + reassurance grid + trending destinations per hub | Implemented |
| `/search` | Server-rendered live results with cabin price chips | Implemented |
| `/flights/[id]` | Flight detail with cabin chooser + seat-map preview | Implemented |
| `/book/[pnr]` | 5-step checkout: itinerary, passengers, seats + meals, payment, review | Implemented |
| `/book/[pnr]/confirmation` | Boarding-pass-style confirmation | Implemented |
| `/trips` | List trips for this browser session + PNR/email lookup | Implemented |
| `/trips/[pnr]` | Trip detail + online check-in entry point | Implemented |
| `/help` | Static contact + about | Implemented |
| `/ops` | Password-gated incident console driving the "3am outage" demo | Implemented |

`/ops` (plus its orchestrator at `/api/ops/tick`) monitors the backend,
flips the seeded outage flag, launches the summarizer/fixer Cursor cloud
agents, and posts to Slack. Runbook: `flylo-air/docs` →
`demo-3am-outage.md`.

`SPEC.md` and the files under `src/app/` are the source of truth for the
route inventory. Update them together when routes change.

## Environment

| Var | Used by |
|---|---|
| `BOOKING_API_URL` | server-side fetches in Server Components |
| `NEXT_PUBLIC_BOOKING_API_URL` | client-side fetches |
| `NEXT_PUBLIC_MARKETING_URL` | "Back to flylo-air.com" link (default `https://www.flylo-air.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | reserved for future realtime |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | reserved for future realtime |
| `OPS_*`, `SLACK_WEBHOOK_URL`, `CURSOR_API_KEY`, `GITHUB_TOKEN`, `CRON_SECRET` | ops incident console; all optional locally (see `.env.example` for each var's role) |

## Design system inheritance

This repo intentionally copies — not imports — the marketing site's
design tokens, fonts, and a handful of UI primitives:

- `src/app/globals.css` — verbatim port of `flylo-air/web` tokens
- `src/lib/fonts.ts` — same Geist + Instrument Serif setup
- `src/components/ui/{Rule,SectionLabel,DataRow}.tsx` — verbatim ports
- `src/components/site/{Header,Footer,Logo,Marquee}.tsx` — booking-app
  adaptations (slimmer nav, "Booking" wordmark, back-link to flylo-air.com)

If we end up wanting a single source of truth later, the cleanest move
is to extract those primitives into a tiny `@flylo/ui` workspace
package shared between this repo, the marketing site, and any future
surface — but copying for now keeps both repos shippable in isolation.

## Deployment

Vercel — `vercel link`, set the env vars in the project settings, push.
No other config needed.
