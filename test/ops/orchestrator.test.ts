import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpsFlag, OpsIncident } from "@/lib/ops/types";

// Shared, mutable in-memory backend the mocks read and write. Declared via
// vi.hoisted so the vi.mock factories (which are hoisted above imports) can see
// it, and the tests can drive it.
const h = vi.hoisted(() => {
  type Flag = OpsFlag;
  const store = {
    flags: new Map<string, Flag>(),
    incidents: [] as OpsIncident[],
    errorCount: 0,
    healthy: true,
    agentsAvailable: false,
    agentStatus: {
      status: "running" as string,
      finalText: null as string | null,
      prUrl: null as string | null,
      prNumber: null as number | null,
    },
    throwOnCreateKind: null as string | null,
    slackPosts: [] as string[],
    launches: { summarizer: 0, fixer: 0 },
    labels: [] as number[],
    seq: 1,
  };
  const reset = () => {
    store.flags = new Map();
    store.incidents = [];
    store.errorCount = 0;
    store.healthy = true;
    store.agentsAvailable = false;
    store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    store.throwOnCreateKind = null;
    store.slackPosts = [];
    store.launches = { summarizer: 0, fixer: 0 };
    store.labels = [];
    store.seq = 1;
  };
  const setFlag = (key: string, enabled: boolean, agoMs = 0) => {
    store.flags.set(key, {
      key,
      enabled,
      updatedAt: new Date(Date.now() - agoMs).toISOString(),
      updatedBy: null,
    });
  };
  return { store, reset, setFlag };
});

vi.mock("@/lib/ops/backend", () => {
  const kindOf = (i: OpsIncident) =>
    i.kind == null || i.kind === "outage" ? "outage" : null;
  return {
    incidentKind: kindOf,
    fetchFlags: async (): Promise<OpsFlag[]> => [...h.store.flags.values()],
    setFlag: async (key: string, enabled: boolean): Promise<OpsFlag[]> => {
      h.store.flags.set(key, {
        key,
        enabled,
        updatedAt: new Date().toISOString(),
        updatedBy: "auto-expiry",
      });
      return [...h.store.flags.values()];
    },
    fetchErrors: async () => [],
    fetchErrorCount: async () => h.store.errorCount,
    fetchIncidents: async (limit = 10): Promise<OpsIncident[]> =>
      [...h.store.incidents]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, limit),
    createIncident: async (input: {
      title?: string;
      kind?: "outage";
      event: { at: string; kind: string; message: string };
    }): Promise<OpsIncident> => {
      const kind = input.kind ?? "outage";
      if (h.store.throwOnCreateKind === kind) {
        throw new Error(`simulated backend failure creating ${kind}`);
      }
      const now = new Date().toISOString();
      const incident: OpsIncident = {
        id: `inc_${h.store.seq++}`,
        status: "open",
        kind,
        title: input.title ?? "",
        startedAt: now,
        resolvedAt: null,
        events: [input.event],
        summarizerAgentId: null,
        fixerAgentId: null,
        summaryPosted: false,
        prUrl: null,
        prNumber: null,
        prPosted: false,
        greenTicks: 0,
        updatedAt: now,
      };
      h.store.incidents.push(incident);
      return incident;
    },
    appendIncidentEvent: async (id: string, event: { kind: string; message: string; at: string }) => {
      const inc = h.store.incidents.find((i) => i.id === id);
      if (!inc) throw new Error(`no incident ${id}`);
      inc.events.push(event);
      inc.updatedAt = new Date().toISOString();
      return inc;
    },
    patchIncident: async (id: string, patch: Partial<OpsIncident>) => {
      const inc = h.store.incidents.find((i) => i.id === id);
      if (!inc) throw new Error(`no incident ${id}`);
      Object.assign(inc, patch);
      inc.updatedAt = new Date().toISOString();
      return inc;
    },
    listDemoSessions: async () => [],
    createDemoSession: async (input: { id: string }) => ({
      id: input.id,
      active: true,
      slackChannel: null,
      runFullArc: true,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    }),
    deactivateDemoSession: async () => {},
  };
});

vi.mock("@/lib/ops/probe", () => ({
  runProbes: async () =>
    [
      {
        id: "search",
        label: "Flight search / pricing",
        path: "/v1/flights/search",
        ok: h.store.healthy,
        status: h.store.healthy ? 200 : 500,
        latencyMs: 5,
      },
    ],
  probesHealthy: (probes: { ok: boolean }[]) => probes.every((p) => p.ok),
}));

vi.mock("@/lib/ops/slack", () => {
  const record = (label: string) => {
    h.store.slackPosts.push(label);
    return { text: label };
  };
  return {
    postSlack: async (post: { text: string }) => {
      h.store.slackPosts.push(post.text);
      return true;
    },
    postSlackWithRef: async (post: { text: string }) => {
      h.store.slackPosts.push(post.text);
      return {
        channel: "CINCIDENTS",
        ts: "1712345678.000100",
      };
    },
    detectionBlocks: () => record("outage_detection"),
    summaryBlocks: () => record("outage_summary"),
    prBlocks: () => record("outage_pr"),
    recoveryBlocks: () => record("outage_recovery"),
  };
});

vi.mock("@/lib/ops/agents", () => ({
  agentsAvailable: () => h.store.agentsAvailable,
  DEMO_LABEL: "demo",
  addDemoLabel: async (_prUrl: string | null, prNumber: number | null) => {
    if (typeof prNumber === "number") h.store.labels.push(prNumber);
    return true;
  },
  getAgentStatus: async () => h.store.agentStatus,
  launchSummarizer: async () => {
    h.store.launches.summarizer++;
    return "agent_summarizer";
  },
  launchFixer: async () => {
    h.store.launches.fixer++;
    return "agent_fixer";
  },
}));

const { runTick } = await import("@/lib/ops/orchestrator");
const OUTAGE = "fare_adjustment_v2";

function slackHas(label: string): boolean {
  return h.store.slackPosts.some((p) => p.includes(label));
}
function outageIncidents(): OpsIncident[] {
  return h.store.incidents.filter((i) => i.kind == null || i.kind === "outage");
}

beforeEach(() => {
  h.reset();
});

describe("outage scenario", () => {
  it("detects on 5xx, posts the alarming detection, and launches summarizer + fixer", async () => {
    h.store.healthy = false;
    h.store.errorCount = 3;
    h.store.agentsAvailable = true;
    h.store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    h.setFlag(OUTAGE, true);

    await runTick();

    const outage = outageIncidents()[0];
    expect(outage.title).toMatch(/5xx on pricing path/i);
    expect(outage.kind).toBe("outage");
    expect(slackHas("outage_detection")).toBe(true);
    expect(h.store.launches.summarizer).toBe(1);
    expect(h.store.launches.fixer).toBe(1);
  });

  it("recovers after the flag is off and probes are healthy", async () => {
    h.store.agentsAvailable = false;
    h.store.errorCount = 0;
    h.store.healthy = true;
    const now = new Date().toISOString();
    h.store.incidents.push({
      id: "inc_out",
      status: "open",
      kind: "outage",
      title: "Booking API 5xx on pricing path",
      startedAt: now,
      resolvedAt: null,
      events: [{ at: now, kind: "detected", message: "x" }],
      summarizerAgentId: null,
      fixerAgentId: null,
      summaryPosted: true,
      prUrl: null,
      prNumber: null,
      prPosted: false,
      greenTicks: 0,
      updatedAt: now,
    });

    await runTick();

    const outage = outageIncidents()[0];
    expect(outage.status).toBe("resolved");
    expect(outage.events.map((e) => e.kind)).toContain("recovered");
    expect(slackHas("outage_recovery")).toBe(true);
  });

  it("degrades gracefully: a backend create failure does not crash the tick", async () => {
    h.store.healthy = false;
    h.store.errorCount = 5;
    h.store.agentsAvailable = true;
    h.store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    h.store.throwOnCreateKind = "outage";
    h.setFlag(OUTAGE, true);

    const snap = await runTick();

    expect(outageIncidents()).toHaveLength(0);
    expect(snap.outageEnabled).toBe(true);
  });
});

function seedResolvedOutage(resolvedAgoMs: number): void {
  const started = new Date(Date.now() - resolvedAgoMs - 1000).toISOString();
  const resolvedAt = new Date(Date.now() - resolvedAgoMs).toISOString();
  h.store.incidents.push({
    id: `inc_resolved_${h.store.seq++}`,
    status: "resolved",
    kind: "outage",
    title: "Booking API 5xx on pricing path",
    startedAt: started,
    resolvedAt,
    events: [{ at: started, kind: "detected", message: "x" }],
    summarizerAgentId: null,
    fixerAgentId: null,
    summaryPosted: true,
    prUrl: null,
    prNumber: null,
    prPosted: false,
    greenTicks: 1,
    updatedAt: resolvedAt,
  });
}

describe("demo PR labelling", () => {
  it("labels the fixer PR 'demo' when it opens and records a pr_labeled event", async () => {
    h.store.healthy = false;
    h.store.errorCount = 5;
    h.store.agentsAvailable = true;
    h.store.agentStatus = {
      status: "finished",
      finalText: "*Impact:* x. *Likely cause:* y. *Next step:* z.",
      prUrl: "https://github.com/flylo-air/booking-backend/pull/77",
      prNumber: 77,
    };
    h.setFlag(OUTAGE, true);

    await runTick();

    const outage = outageIncidents()[0];
    expect(outage.prPosted).toBe(true);
    expect(h.store.labels).toContain(77);
    expect(outage.events.map((e) => e.kind)).toContain("pr_labeled");

    h.store.labels = [];
    await runTick();
    expect(h.store.labels).not.toContain(77);
  });
});

describe("outage re-trigger loop is fixed", () => {
  it("regression: resolved incident with stale 5xx in the window and flag OFF does not re-open", async () => {
    delete process.env.INCIDENT_REDETECT_COOLDOWN_SECONDS;
    delete process.env.MAX_INCIDENTS_PER_HOUR;
    h.store.agentsAvailable = false;
    h.store.healthy = true;
    h.store.errorCount = 5;
    h.setFlag(OUTAGE, false);
    seedResolvedOutage(1000);

    await runTick();

    expect(outageIncidents()).toHaveLength(1);
    expect(outageIncidents()[0].status).toBe("resolved");
    expect(slackHas("outage_detection")).toBe(false);
  });

  it("cooldown blocks re-detection, then allows it once the cooldown elapses", async () => {
    process.env.INCIDENT_REDETECT_COOLDOWN_SECONDS = "300";
    delete process.env.MAX_INCIDENTS_PER_HOUR;
    h.store.agentsAvailable = false;
    h.store.healthy = true;
    h.store.errorCount = 5;
    h.setFlag(OUTAGE, false);

    seedResolvedOutage(30_000);
    await runTick();
    expect(outageIncidents()).toHaveLength(1);
    expect(slackHas("outage_detection")).toBe(false);

    h.reset();
    process.env.INCIDENT_REDETECT_COOLDOWN_SECONDS = "300";
    h.store.agentsAvailable = false;
    h.store.healthy = true;
    h.store.errorCount = 5;
    h.setFlag(OUTAGE, false);
    seedResolvedOutage(400_000);
    await runTick();
    const outages = outageIncidents();
    expect(outages).toHaveLength(2);
    expect(slackHas("outage_detection")).toBe(true);
  });

  it("per-hour cap blocks a further incident even when the outage is active", async () => {
    process.env.MAX_INCIDENTS_PER_HOUR = "6";
    delete process.env.INCIDENT_REDETECT_COOLDOWN_SECONDS;
    h.store.agentsAvailable = false;
    h.store.healthy = false;
    h.store.errorCount = 5;
    h.setFlag(OUTAGE, true);
    for (let n = 0; n < 6; n++) seedResolvedOutage(60_000 * (n + 1));
    expect(outageIncidents()).toHaveLength(6);

    await runTick();

    expect(outageIncidents()).toHaveLength(6);
    expect(slackHas("outage_detection")).toBe(false);
  });

  it("happy path: flag on opens ONE incident, flag off recovers ONCE and stays resolved", async () => {
    delete process.env.INCIDENT_REDETECT_COOLDOWN_SECONDS;
    delete process.env.MAX_INCIDENTS_PER_HOUR;
    h.store.agentsAvailable = false;

    h.store.healthy = false;
    h.store.errorCount = 3;
    h.setFlag(OUTAGE, true);
    await runTick();
    expect(outageIncidents()).toHaveLength(1);
    expect(outageIncidents()[0].status).toBe("open");
    expect(slackHas("outage_detection")).toBe(true);

    h.setFlag(OUTAGE, false);
    h.store.healthy = true;
    h.store.errorCount = 5;
    await runTick();
    expect(outageIncidents()).toHaveLength(1);
    expect(outageIncidents()[0].status).toBe("resolved");
    expect(slackHas("outage_recovery")).toBe(true);

    await runTick();
    const outages = outageIncidents();
    expect(outages).toHaveLength(1);
    expect(outages[0].status).toBe("resolved");
    expect(outages[0].events.filter((e) => e.kind === "detected")).toHaveLength(1);
    expect(outages[0].events.filter((e) => e.kind === "recovered")).toHaveLength(1);
  });
});
