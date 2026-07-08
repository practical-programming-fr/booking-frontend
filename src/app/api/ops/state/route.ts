import { NextResponse } from "next/server";
import { isOpsAuthed } from "@/lib/ops/auth";
import { buildSnapshot } from "@/lib/ops/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!(await isOpsAuthed())) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    const snapshot = await buildSnapshot();
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
