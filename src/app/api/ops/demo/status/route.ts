import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isOpsAuthed } from "@/lib/ops/auth";
import { fetchIncidents, listDemoSessions } from "@/lib/ops/backend";
import { getCrewNocUrl } from "@/lib/ops/config";
import { DEMO_SESSION_COOKIE } from "@/lib/ops/types";
import { demoSessionIdOfIncident, isSessionScopedIncident } from "@/lib/ops/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Status of THIS browser's demo session: whether it is currently in a scoped
// outage, and how far the incident arc has progressed (for the console UI).
export async function GET(): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const store = await cookies();
  const id = store.get(DEMO_SESSION_COOKIE)?.value ?? null;
  if (!id) {
    return NextResponse.json({ sessionId: null, active: false });
  }

  const nocBase = getCrewNocUrl();
  const nocUrl = nocBase
    ? `${nocBase}${nocBase.includes("?") ? "&" : "?"}demo=${encodeURIComponent(id)}`
    : null;

  try {
    const [sessions, incidents] = await Promise.all([
      listDemoSessions(),
      fetchIncidents(100),
    ]);
    const session = sessions.find((s) => s.id === id) ?? null;
    const incident =
      incidents.find(
        (i) => isSessionScopedIncident(i) && demoSessionIdOfIncident(i) === id,
      ) ?? null;
    return NextResponse.json({
      sessionId: id,
      active: Boolean(session?.active),
      session: session
        ? {
            id: session.id,
            active: session.active,
            slackChannel: session.slackChannel,
            runFullArc: session.runFullArc,
            expiresAt: session.expiresAt,
          }
        : null,
      incident: incident
        ? {
            status: incident.status,
            summaryPosted: incident.summaryPosted,
            prUrl: incident.prUrl,
            prNumber: incident.prNumber,
          }
        : null,
      nocUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Still report the cookie-held session id so the UI can offer Resolve.
    return NextResponse.json({ sessionId: id, active: false, error: message, nocUrl });
  }
}
