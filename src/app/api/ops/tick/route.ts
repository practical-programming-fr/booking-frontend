import { NextResponse } from "next/server";
import { isTickAuthorized } from "@/lib/ops/auth";
import { runTick } from "@/lib/ops/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  if (!(await isTickAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  try {
    const snapshot = await runTick();
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET for Vercel Cron (which issues GET), POST for the dashboard poll.
export async function GET(req: Request): Promise<Response> {
  return handle(req);
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
