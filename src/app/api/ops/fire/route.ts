import { NextResponse } from "next/server";
import { isOpsAuthed } from "@/lib/ops/auth";
import { runTick } from "@/lib/ops/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// "Fire agents now" escape hatch: forces incident detection and agent launch
// without waiting for the error threshold, for tightly-timed live demos.
export async function POST(): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    const snapshot = await runTick({ force: true });
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
