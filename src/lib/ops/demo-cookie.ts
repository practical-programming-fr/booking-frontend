import "server-only";

import type { NextResponse } from "next/server";
import { DEMO_SESSION_COOKIE } from "./types";
import { getDemoCookieDomainSetting } from "./config";

// Cookie plumbing for the per-session demo outage. The cookie is intentionally
// NOT httpOnly: client-side booking API calls read it to forward the
// x-demo-session header (same rationale as the booking-session cookie).

// Resolve the cookie domain from the request host. In production the demo runs
// on book.flylo-air.com and we want the cookie shared across *.flylo-air.com;
// anywhere else (localhost, Vercel previews) must stay host-only or the cookie
// silently fails to set.
export function resolveDemoCookieDomain(host: string | null): string | undefined {
  if (!host) return undefined;
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (hostname === "flylo-air.com" || hostname.endsWith(".flylo-air.com")) {
    return getDemoCookieDomainSetting();
  }
  return undefined;
}

export function setDemoCookie(
  res: NextResponse,
  id: string,
  ttlSeconds: number,
  host: string | null,
): void {
  res.cookies.set(DEMO_SESSION_COOKIE, id, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlSeconds,
    domain: resolveDemoCookieDomain(host),
  });
}

export function clearDemoCookie(res: NextResponse, host: string | null): void {
  res.cookies.set(DEMO_SESSION_COOKIE, "", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    domain: resolveDemoCookieDomain(host),
  });
}
