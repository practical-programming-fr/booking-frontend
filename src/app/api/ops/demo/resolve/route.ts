import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isOpsAuthed } from "@/lib/ops/auth";
import { deactivateDemoSession } from "@/lib/ops/backend";
import { DEMO_SESSION_COOKIE } from "@/lib/ops/types";
import { clearDemoCookie } from "@/lib/ops/demo-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resolve / all clear: deactivate this browser's demo session on the backend
// and clear the cookie, so the site is healthy again for this browser. The
// orchestrator posts the recovery beat once the session drops off the active
// list on its next tick.
export async function POST(req: Request): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  let bodyId: string | null = null;
  try {
    const body = (await req.json()) as { id?: string };
    bodyId = body?.id ?? null;
  } catch {
    // no body is fine; fall back to the cookie
  }
  const store = await cookies();
  const id = bodyId ?? store.get(DEMO_SESSION_COOKIE)?.value ?? null;

  const res = NextResponse.json({ ok: true, id });
  clearDemoCookie(res, req.headers.get("host"));

  if (id) {
    try {
      await deactivateDemoSession(id);
    } catch (err) {
      // The cookie is cleared regardless, so this browser heals immediately.
      // Surface the backend error but keep the 200 (best effort teardown).
      console.warn(
        "[ops/demo/resolve] backend deactivate failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return res;
}
