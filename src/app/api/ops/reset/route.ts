import { NextResponse } from "next/server";
import { isOpsAuthed } from "@/lib/ops/auth";
import { resetOps } from "@/lib/ops/backend";
import { buildSnapshot } from "@/lib/ops/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Disable the outage flag, clear the error log, and close open incidents.
// Instant recovery hatch and post-demo cleanup. (The nightly workflow also
// reverts the seeded code; this only touches runtime state.)
export async function POST(): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    await resetOps();
    const snapshot = await buildSnapshot();
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
