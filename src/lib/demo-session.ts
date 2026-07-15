// Per-session ("scoped") demo outage identity for the booking site.
//
// A presenter triggers an outage from the /ops console. That sets a first-party
// cookie (flylo_demo_session) holding a demo session id. Every booking API call
// this app makes forwards that id as the `x-demo-session` header, so the backend
// returns 500s for this browser only. The cookie is intentionally readable from
// JS (not httpOnly) so client-side API calls can forward it, mirroring the
// existing booking-session cookie. It is set/cleared by the server routes under
// /api/ops/demo so the domain and TTL stay consistent.

import { DEMO_SESSION_COOKIE, DEMO_SESSION_HEADER } from "./ops/types";

export { DEMO_SESSION_COOKIE, DEMO_SESSION_HEADER };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const pair of document.cookie.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("=")) || null;
    }
  }
  return null;
}

// Browser: read the demo session id from document.cookie, if any.
export function readDemoSessionClient(): string | null {
  return readCookie(DEMO_SESSION_COOKIE);
}

// Server: read the demo session id from the request cookie via next/headers.
export async function getDemoSessionForServer(): Promise<string> {
  if (typeof window !== "undefined") return "";
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(DEMO_SESSION_COOKIE)?.value ?? "";
  } catch {
    return "";
  }
}

// Resolve the demo session id in whichever runtime we are in. Used by the API
// client to attach the x-demo-session header on both server and client fetches.
export async function resolveDemoSessionId(): Promise<string> {
  if (typeof window === "undefined") {
    return await getDemoSessionForServer();
  }
  return readDemoSessionClient() ?? "";
}
