import { NextResponse } from "next/server";
import { isOpsAuthed } from "@/lib/ops/auth";
import { setFlag } from "@/lib/ops/backend";
import { buildSnapshot } from "@/lib/ops/orchestrator";
import { FARE_ADJUSTMENT_FLAG, getActorHeader } from "@/lib/ops/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Best-effort identity for the transparent "flipped by <who>" banner. Reads a
// configured SSO-forwarded header (e.g. an email) when the console is hosted
// behind SSO; falls back to a body-supplied actor, else null.
function resolveActor(req: Request, bodyActor?: string | null): string | null {
  const header = getActorHeader();
  if (header) {
    const v = req.headers.get(header);
    if (v) return v;
  }
  return bodyActor ?? null;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  let body: { key?: string; enabled?: boolean; actor?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const key = body.key ?? FARE_ADJUSTMENT_FLAG;
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    await setFlag(key, body.enabled, resolveActor(req, body.actor));
    const snapshot = await buildSnapshot();
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
