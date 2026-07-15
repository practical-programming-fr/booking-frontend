import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isOpsAuthed } from "@/lib/ops/auth";
import { createDemoSession } from "@/lib/ops/backend";
import { getCrewNocUrl, getDemoSessionTtlMinutes } from "@/lib/ops/config";
import { setDemoCookie } from "@/lib/ops/demo-cookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Trigger a per-session ("scoped") outage for the caller's browser only.
// Generates a session id, activates it on the backend (which then serves 500s
// to requests carrying x-demo-session=<id>), and sets the first-party cookie so
// this app forwards that header. `quiet` means "visual outage only": the site
// still 500s but the orchestrator opens no incident and launches no agents.
export async function POST(req: Request): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  let body: { channel?: string | null; quiet?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const channel = (body.channel ?? "").trim() || null;
  const runFullArc = body.quiet !== true;
  const ttlSeconds = getDemoSessionTtlMinutes() * 60;
  const id = randomUUID();

  try {
    const session = await createDemoSession({
      id,
      slackChannel: channel,
      runFullArc,
      ttlSeconds,
    });
    const nocBase = getCrewNocUrl();
    const nocUrl = nocBase
      ? `${nocBase}${nocBase.includes("?") ? "&" : "?"}demo=${encodeURIComponent(session.id)}`
      : null;
    const res = NextResponse.json({
      session: {
        id: session.id,
        active: session.active,
        slackChannel: session.slackChannel,
        runFullArc: session.runFullArc,
        expiresAt: session.expiresAt,
      },
      nocUrl,
      ttlSeconds,
    });
    setDemoCookie(res, session.id, ttlSeconds, req.headers.get("host"));
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
