import "server-only";

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getCronSecret, getOpsDashboardPassword } from "./config";

// Lightweight cookie gate for the ops API routes (/api/ops/*). This is a demo
// gate, not production auth: it keeps the incident controls off the public
// surface. When OPS_DASHBOARD_PASSWORD is unset (local dev) they are open.

const COOKIE_NAME = "flylo_ops";
const MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

function expectedToken(password: string): string {
  // Deterministic token derived from the password so we can validate the
  // cookie without server-side session storage.
  return createHmac("sha256", password).update("flylo-ops-console").digest("hex");
}

export async function isOpsAuthed(): Promise<boolean> {
  const password = getOpsDashboardPassword();
  if (!password) return true; // open in local dev
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return false;
  const expected = expectedToken(password);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function signInOps(password: string): Promise<boolean> {
  const expected = getOpsDashboardPassword();
  if (!expected) return true; // no gate configured
  if (password !== expected) return false;
  const store = await cookies();
  store.set(COOKIE_NAME, expectedToken(expected), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return true;
}

export async function signOutOps(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

// The tick endpoint is callable by a cookie-authenticated caller (the ops
// password cookie) or by Vercel Cron / automation (Authorization: Bearer
// <CRON_SECRET>). If neither an ops password nor a cron secret is configured
// (local dev), it is open.
export async function isTickAuthorized(req: Request): Promise<boolean> {
  if (await isOpsAuthed()) return true;
  const cronSecret = getCronSecret();
  if (cronSecret) {
    const provided = req.headers.get("authorization");
    if (provided === `Bearer ${cronSecret}`) return true;
  }
  return false;
}
