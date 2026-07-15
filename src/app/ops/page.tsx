import type { Metadata } from "next";
import { isOpsAuthed } from "@/lib/ops/auth";
import { getOpsDashboardPassword } from "@/lib/ops/config";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Rule } from "@/components/ui/Rule";
import { OpsLogin } from "./OpsLogin";
import { OpsConsole } from "./OpsConsole";

export const dynamic = "force-dynamic";

// Internal tool: keep it out of search indexes.
export const metadata: Metadata = {
  title: "Ops Console",
  robots: { index: false, follow: false },
};

// The FlyLo Ops Console. An internal, employee-facing admin surface used to run
// a scoped demo outage for the presenter's own browser. Gated by a password
// (OPS_DASHBOARD_PASSWORD). When no password is configured (local dev) the gate
// is open, mirroring the existing ops API behavior.
export default async function OpsPage() {
  const authed = await isOpsAuthed();
  const gated = Boolean(getOpsDashboardPassword());

  return (
    <div className="container-rams py-14 md:py-20">
      <SectionLabel index="OPS" label="Operations Console" />
      <h1
        className="mt-6 font-display leading-[0.96] tracking-[-0.02em]"
        style={{ fontSize: "clamp(36px, 6vw, 72px)" }}
      >
        FlyLo Ops Console
      </h1>
      <p className="mt-5 max-w-[62ch] text-[15px] leading-[1.6] text-[color:var(--ink-soft)] md:text-[16px]">
        Internal incident tooling. Run a scoped service exercise against your own
        session without affecting live customers, and route the incident to your
        team channel.
      </p>
      <Rule className="mt-8" />

      <div className="mt-10">
        {authed ? <OpsConsole /> : <OpsLogin gated={gated} />}
      </div>
    </div>
  );
}
