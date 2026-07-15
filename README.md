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

`/ops` is an internal, employee-facing Ops Console (password gated by
`OPS_DASHBOARD_PASSWORD`). It runs a per-session ("scoped") demo outage: a
presenter clicks "Trigger outage" and only their own browser starts getting
500s from the booking API, while every other visitor stays healthy. This works
by activating a demo session on the backend, setting the `flylo_demo_session`
cookie, and forwarding it as the `x-demo-session` header on every booking API
call (see `src/lib/demo-session.ts` and `src/lib/api.ts`).

The orchestrator runs headless: `/api/ops/tick` (invoked by Vercel Cron, see
`vercel.json`) monitors the backend, launches the summarizer/fixer Cursor cloud
agents, posts to Slack, and opens the fix PR. It drives two paths that never
clobber each other:

- The GLOBAL outage/spike scenarios, keyed off the seeded feature flags (flipped
  by a separate internal admin app via booking-backend `/v1/_ops`), unchanged.
- The PER-SESSION scoped outages: each active demo session runs its own
  independent incident arc (detect, Slack, agents, PR, recovery) routed to that
  presenter's own Slack channel via a Slack bot token (`SLACK_BOT_TOKEN`), so a
  hundred simultaneous demos do not collide in one shared channel. Set a
  session's mode to "visual only" to break the site without opening an incident.

Runbook: `flylo-air/docs`, `demo-3am-outage.md`.

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
| `OPS_*`, `SLACK_WEBHOOK_URL`, `CURSOR_API_KEY`, `GITHUB_TOKEN`, `CRON_SECRET` | incident orchestrator (tick, agents, Slack, fix PR); all optional locally (see `.env.example` for each var's role) |
| `OPS_DASHBOARD_PASSWORD` | password gate for the `/ops` Ops Console (open locally when unset) |
| `OPS_SHARED_SECRET` | bearer token for backend `/v1/_ops`, including demo-session management |
| `SLACK_BOT_TOKEN` | optional Slack bot token (`chat:write`) for per-channel incident routing; falls back to `SLACK_WEBHOOK_URL` when unset |
| `SLACK_AUTO_CREATE_CHANNEL` | optional; when `1`/`true` (needs bot `channels:manage`) the orchestrator may auto-create a named channel. Default off |
| `DEMO_SESSION_TTL_MINUTES` | scoped demo outage self-heal TTL (default 20) |
| `DEMO_SESSION_COOKIE_DOMAIN` | cookie domain for the demo session (default `.flylo-air.com`; only applied on flylo-air.com hosts) |
| `CREW_NOC_URL` / `NEXT_PUBLIC_CREW_NOC_URL` | optional crew NOC base URL; the console links `?demo=<id>` to it |

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
