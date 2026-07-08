import type { Metadata } from "next";
import { isOpsAuthed } from "@/lib/ops/auth";
import { buildSnapshot } from "@/lib/ops/orchestrator";
import { getOpsDashboardPassword } from "@/lib/ops/config";
import type { OpsSnapshot } from "@/lib/ops/types";
import { OpsConsole } from "./OpsConsole";
import { OpsLogin } from "./OpsLogin";

export const metadata: Metadata = {
  title: "Incident console",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const authed = await isOpsAuthed();
  if (!authed) {
    return <OpsLogin />;
  }

  let snapshot: OpsSnapshot | null = null;
  let error: string | null = null;
  try {
    snapshot = await buildSnapshot();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <OpsConsole
      initialSnapshot={snapshot}
      initialError={error}
      gated={Boolean(getOpsDashboardPassword())}
    />
  );
}
