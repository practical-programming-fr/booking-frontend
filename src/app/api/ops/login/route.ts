import { NextResponse } from "next/server";
import { signInOps } from "@/lib/ops/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ok = await signInOps(body.password ?? "");
  if (!ok) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
