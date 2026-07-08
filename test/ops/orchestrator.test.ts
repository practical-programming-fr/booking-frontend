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
    launches: { summarizer: 0, fixer: 0, investigator: 0 },
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
    store.launches = { summarizer: 0, fixer: 0, investigator: 0 };
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
  const kindOf = (i: OpsIncident) => i.kind ?? "outage";
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
    fetchOpenIncidentByKind: async (kind: string): Promise<OpsIncident | null> =>
      h.store.incidents.find((i) => i.status === "open" && kindOf(i) === kind) ?? null,
    createIncident: async (input: {
      title?: string;
      kind?: "outage" | "spike";
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
    detectionBlocks: () => record("outage_detection"),
    summaryBlocks: () => record("outage_summary"),
    prBlocks: () => record("outage_pr"),
    recoveryBlocks: () => record("outage_recovery"),
    spikeDetectedBlocks: () => record("spike_detected"),
    spikeInvestigationBlocks: (t: string) => ({ text: `spike_investigation:${t}` }),
    spikeRecoveredBlocks: () => record("spike_recovered"),
  };
});

vi.mock("@/lib/ops/agents", () => ({
  agentsAvailable: () => h.store.agentsAvailable,
  addDemoLabel: async () => {},
  getAgentStatus: async () => h.store.agentStatus,
  launchSummarizer: async () => {
    h.store.launches.summarizer++;
    return "agent_summarizer";
  },
  launchFixer: async () => {
    h.store.launches.fixer++;
    return "agent_fixer";
  },
  launchInvestigator: async () => {
    h.store.launches.investigator++;
    return "agent_investigator";
  },
}));

const { runTick } = await import("@/lib/ops/orchestrator");
const SPIKE = "traffic_spike_sim";
const OUTAGE = "fare_adjustment_v2";

function slackHas(label: string): boolean {
  return h.store.slackPosts.some((p) => p.includes(label));
}
function incidentsOfKind(kind: "outage" | "spike"): OpsIncident[] {
  return h.store.incidents.filter((i) => (i.kind ?? "outage") === kind);
}

beforeEach(() => {
  h.reset();
});

describe("transient (spike) scenario", () => {
  it("creates a benign incident and self-heals on the TTL (no agents)", async () => {
    process.env.SPIKE_TTL_SECONDS = "0"; // TTL elapsed immediately
    h.store.agentsAvailable = false;
    h.setFlag(SPIKE, true);

    const snap = await runTick();

    const spikes = incidentsOfKind("spike");
    expect(spikes).toHaveLength(1);
    const spike = spikes[0];
    // Benign framing: title is degraded performance, not an outage.
    expect(spike.title).toMatch(/degraded performance/i);
    // The site stays healthy: no outage incident, snapshot has no probe failure.
    expect(incidentsOfKind("outage")).toHaveLength(0);

    // Detection was the measured spike ping, never the alarming outage one.
    expect(slackHas("spike_detected")).toBe(true);
    expect(slackHas("outage_detection")).toBe(false);

    // The narrative beat: investigated and concluded transient / non-issue.
    expect(slackHas("spike_investigation")).toBe(true);
    const eventKinds = spike.events.map((e) => e.kind);
    expect(eventKinds).toContain("investigation_posted");

    // Self-healed: resolved with a recovered event, flag flipped off.
    expect(spike.status).toBe("resolved");
    expect(spike.resolvedAt).not.toBeNull();
    expect(eventKinds).toContain("recovered");
    expect(slackHas("spike_recovered")).toBe(true);
    expect(h.store.flags.get(SPIKE)?.enabled).toBe(false);

    // Snapshot reflects the transient, and it is now resolved (not open).
    expect(snap.spikeEnabled).toBe(false);
    expect(snap.spikeIncident).toBeNull();
  });

  it("does not launch a fixer or open a PR (investigate only, even with agents)", async () => {
    process.env.SPIKE_TTL_SECONDS = "0";
    h.store.agentsAvailable = true;
    h.store.agentStatus = {
      status: "finished",
      finalText: "*What we saw:* brief latency. *Assessment:* transient. *Recommendation:* no action.",
      prUrl: null,
      prNumber: null,
    };
    h.setFlag(SPIKE, true);

    await runTick();

    // A single investigator ran; never a fixer, never a summarizer.
    expect(h.store.launches.investigator).toBe(1);
    expect(h.store.launches.fixer).toBe(0);
    expect(h.store.launches.summarizer).toBe(0);

    // No PR was ever posted for the transient.
    expect(slackHas("outage_pr")).toBe(false);
    const spike = incidentsOfKind("spike")[0];
    expect(spike.prUrl).toBeNull();
    expect(spike.prPosted).toBe(false);
    // The agent's assessment was posted as the investigation conclusion.
    expect(slackHas("spike_investigation:*What we saw:*")).toBe(true);
  });

  it("stays open until the TTL elapses", async () => {
    process.env.SPIKE_TTL_SECONDS = "999";
    h.store.agentsAvailable = false;
    h.setFlag(SPIKE, true);

    const snap = await runTick();

    const spike = incidentsOfKind("spike")[0];
    expect(spike.status).toBe("open");
    expect(snap.spikeIncident?.id).toBe(spike.id);
    // Flag left on because it has not expired yet.
    expect(h.store.flags.get(SPIKE)?.enabled).toBe(true);
  });

  it("resolves when the flag is turned off before the TTL", async () => {
    process.env.SPIKE_TTL_SECONDS = "999";
    h.store.agentsAvailable = false;
    // Open incident already exists, flag now off.
    h.setFlag(SPIKE, false);
    const now = new Date().toISOString();
    h.store.incidents.push({
      id: "inc_pre",
      status: "open",
      kind: "spike",
      title: "Degraded performance on booking API",
      startedAt: now,
      resolvedAt: null,
      events: [{ at: now, kind: "detected", message: "x" }],
      summarizerAgentId: null,
      fixerAgentId: null,
      summaryPosted: false,
      prUrl: null,
      prNumber: null,
      prPosted: false,
      greenTicks: 0,
      updatedAt: now,
    });

    await runTick();

    const spike = incidentsOfKind("spike")[0];
    expect(spike.status).toBe("resolved");
    expect(spike.events.map((e) => e.kind)).toContain("recovered");
  });
});

describe("clash safety (both scenarios active at once)", () => {
  it("does not throw and represents both when both flags are on", async () => {
    process.env.SPIKE_TTL_SECONDS = "999"; // spike stays open
    h.store.healthy = false; // outage persists (unhealthy probes)
    h.store.errorCount = 5; // trips outage detection
    h.store.agentsAvailable = true;
    h.store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    h.setFlag(OUTAGE, true);
    h.setFlag(SPIKE, true);

    const snap = await runTick();

    // Both incidents exist and are open, tracked independently.
    const outages = incidentsOfKind("outage");
    const spikes = incidentsOfKind("spike");
    expect(outages).toHaveLength(1);
    expect(spikes).toHaveLength(1);
    expect(outages[0].status).toBe("open");
    expect(spikes[0].status).toBe("open");

    // The outage branch launched its agents; the spike did not get a fixer.
    expect(h.store.launches.fixer).toBe(1);
    expect(h.store.launches.investigator).toBe(1);

    // Snapshot surfaces both.
    expect(snap.outageEnabled).toBe(true);
    expect(snap.spikeEnabled).toBe(true);
    expect(snap.incident?.kind ?? "outage").toBe("outage"); // outage preferred
    expect(snap.spikeIncident?.kind).toBe("spike");
  });

  it("degrades gracefully: a spike backend failure does not crash the tick or the outage", async () => {
    process.env.SPIKE_TTL_SECONDS = "999";
    h.store.healthy = false;
    h.store.errorCount = 5;
    h.store.agentsAvailable = true;
    h.store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    h.store.throwOnCreateKind = "spike"; // spike block will throw internally
    h.setFlag(OUTAGE, true);
    h.setFlag(SPIKE, true);

    // Must not throw despite the spike block failing.
    const snap = await runTick();

    // Outage still handled normally.
    expect(incidentsOfKind("outage")).toHaveLength(1);
    expect(incidentsOfKind("spike")).toHaveLength(0);
    // A snapshot is always returned, with both flags still reflected.
    expect(snap.outageEnabled).toBe(true);
    expect(snap.spikeEnabled).toBe(true);
  });
});

describe("outage scenario is unchanged", () => {
  it("detects on 5xx, posts the alarming detection, and launches summarizer + fixer", async () => {
    process.env.SPIKE_TTL_SECONDS = "999";
    h.store.healthy = false;
    h.store.errorCount = 3;
    h.store.agentsAvailable = true;
    h.store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    h.setFlag(OUTAGE, true);

    await runTick();

    const outage = incidentsOfKind("outage")[0];
    expect(outage.title).toMatch(/5xx on pricing path/i);
    expect(outage.kind).toBe("outage");
    expect(slackHas("outage_detection")).toBe(true);
    expect(h.store.launches.summarizer).toBe(1);
    expect(h.store.launches.fixer).toBe(1);
    // No transient incident when only the outage flag is on.
    expect(incidentsOfKind("spike")).toHaveLength(0);
  });

  it("recovers after the flag is off and probes are healthy", async () => {
    process.env.SPIKE_TTL_SECONDS = "999";
    h.store.agentsAvailable = false;
    h.store.errorCount = 0;
    h.store.healthy = true;
    // Pre-existing open outage; flag already off.
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

    const outage = incidentsOfKind("outage")[0];
    expect(outage.status).toBe("resolved");
    expect(outage.events.map((e) => e.kind)).toContain("recovered");
    expect(slackHas("outage_recovery")).toBe(true);
  });
});
