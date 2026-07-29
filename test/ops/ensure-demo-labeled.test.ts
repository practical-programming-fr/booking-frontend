import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsIncident } from "@/lib/ops/types";

const h = vi.hoisted(() => ({
  addDemoLabel: vi.fn(),
  appended: [] as { id: string; kind: string; message: string }[],
}));

vi.mock("@/lib/ops/agents", () => ({
  DEMO_LABEL: "demo",
  addDemoLabel: (...args: unknown[]) => h.addDemoLabel(...args),
}));

vi.mock("@/lib/ops/backend", () => ({
  appendIncidentEvent: async (
    id: string,
    event: { kind: string; message: string; at: string },
  ) => {
    h.appended.push({ id, kind: event.kind, message: event.message });
    return null;
  },
}));

const { ensureDemoLabeled, PR_LABELED_EVENT, LABEL_ERROR_EVENT } = await import(
  "@/lib/ops/labeling"
);

function incident(over: Partial<OpsIncident> = {}): OpsIncident {
  const now = new Date().toISOString();
  return {
    id: "inc_1",
    status: "open",
    kind: "outage",
    title: "Booking API 5xx on pricing path",
    startedAt: now,
    resolvedAt: null,
    events: [{ at: now, kind: "detected", message: "x" }],
    summarizerAgentId: null,
    fixerAgentId: "agent_fixer",
    summaryPosted: true,
    prUrl: "https://github.com/flylo-air/booking-backend/pull/9",
    prNumber: 9,
    prPosted: true,
    greenTicks: 0,
    updatedAt: now,
    ...over,
  };
}

beforeEach(() => {
  h.addDemoLabel.mockReset();
  h.appended = [];
});

describe("ensureDemoLabeled", () => {
  it("no-ops when the incident has no PR", async () => {
    await ensureDemoLabeled(incident({ prUrl: null }));
    expect(h.addDemoLabel).not.toHaveBeenCalled();
    expect(h.appended).toHaveLength(0);
  });

  it("labels the PR and records a pr_labeled event", async () => {
    h.addDemoLabel.mockResolvedValue(true);
    await ensureDemoLabeled(incident());
    expect(h.addDemoLabel).toHaveBeenCalledWith(
      "https://github.com/flylo-air/booking-backend/pull/9",
      9,
    );
    expect(h.appended.map((e) => e.kind)).toContain(PR_LABELED_EVENT);
  });

  it("does not re-label once a pr_labeled event exists (idempotent)", async () => {
    const now = new Date().toISOString();
    await ensureDemoLabeled(
      incident({
        events: [{ at: now, kind: PR_LABELED_EVENT, message: "done" }],
      }),
    );
    expect(h.addDemoLabel).not.toHaveBeenCalled();
  });

  it("records a loud label_error event when labelling fails, never throws", async () => {
    h.addDemoLabel.mockRejectedValue(new Error("403 no permission"));
    await expect(ensureDemoLabeled(incident())).resolves.toBeDefined();
    const errorEvents = h.appended.filter((e) => e.kind === LABEL_ERROR_EVENT);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].message).toContain("403 no permission");
  });

  it("does not record a pr_labeled event when labelling is skipped (no token)", async () => {
    h.addDemoLabel.mockResolvedValue(false);
    await ensureDemoLabeled(incident());
    expect(h.appended).toHaveLength(0);
  });
});
