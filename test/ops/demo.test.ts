import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DemoSession, OpsIncident } from "@/lib/ops/types";

// In-memory backend + collaborators for the per-session ("scoped") demo arc.
const h = vi.hoisted(() => {
  const store = {
    sessions: [] as DemoSession[],
    incidents: [] as OpsIncident[],
    agentsAvailable: false,
    agentStatus: {
      status: "running" as string,
      finalText: null as string | null,
      prUrl: null as string | null,
      prNumber: null as number | null,
    },
    slackPosts: [] as { text: string; channel?: string | null }[],
    launches: { summarizer: 0, fixer: 0 },
    labels: [] as number[],
    seq: 1,
  };
  const reset = () => {
    store.sessions = [];
    store.incidents = [];
    store.agentsAvailable = false;
    store.agentStatus = { status: "running", finalText: null, prUrl: null, prNumber: null };
    store.slackPosts = [];
    store.launches = { summarizer: 0, fixer: 0 };
    store.labels = [];
    store.seq = 1;
  };
  return { store, reset };
});

vi.mock("@/lib/ops/backend", () => {
  const kindOf = (i: OpsIncident) => i.kind ?? "outage";
  return {
    incidentKind: kindOf,
    listDemoSessions: async (): Promise<DemoSession[]> => [...h.store.sessions],
    fetchIncidents: async (limit = 100): Promise<OpsIncident[]> =>
      [...h.store.incidents]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, limit),
    fetchErrors: async () => [],
    fetchErrorCount: async () => 0,
    createIncident: async (input: {
      title?: string;
      kind?: "outage" | "spike";
      event: { at: string; kind: string; message: string; data?: Record<string, unknown> };
    }): Promise<OpsIncident> => {
      const now = new Date().toISOString();
      const incident: OpsIncident = {
        id: `inc_${h.store.seq++}`,
        status: "open",
        kind: input.kind ?? "outage",
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
    appendIncidentEvent: async (
      id: string,
      event: { kind: string; message: string; at: string },
    ) => {
      const inc = h.store.incidents.find((i) => i.id === id)!;
      inc.events.push(event);
      inc.updatedAt = new Date().toISOString();
      return inc;
    },
    patchIncident: async (id: string, patch: Partial<OpsIncident>) => {
      const inc = h.store.incidents.find((i) => i.id === id)!;
      Object.assign(inc, patch);
      inc.updatedAt = new Date().toISOString();
      return inc;
    },
  };
});

vi.mock("@/lib/ops/slack", () => {
  const push = (text: string) => (opts?: { channel?: string | null }) => {
    h.store.slackPosts.push({ text, channel: opts?.channel ?? null });
    return { text };
  };
  return {
    postSlack: async (post: { text: string }, opts?: { channel?: string | null }) => {
      h.store.slackPosts.push({ text: post.text, channel: opts?.channel ?? null });
      return true;
    },
    detectionBlocks: () => ({ text: "detection" }),
    summaryBlocks: (t: string) => ({ text: `summary:${t.slice(0, 12)}` }),
    prBlocks: (url: string) => ({ text: `pr:${url}` }),
    recoveryBlocks: () => ({ text: "recovery" }),
    // unused here but exported for import parity
    spikeDetectedBlocks: push("spike_detected"),
    spikeInvestigationBlocks: push("spike_investigation"),
    spikeRecoveredBlocks: push("spike_recovered"),
  };
});

vi.mock("@/lib/ops/agents", () => ({
  agentsAvailable: () => h.store.agentsAvailable,
  addDemoLabel: async (n: number) => {
    h.store.labels.push(n);
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

const { runDemoSessionsTick, isSessionScopedIncident, demoSessionIdOfIncident } =
  await import("@/lib/ops/demo");

function session(over: Partial<DemoSession> & { id: string }): DemoSession {
  return {
    id: over.id,
    active: over.active ?? true,
    slackChannel: over.slackChannel ?? null,
    runFullArc: over.runFullArc ?? true,
    createdAt: over.createdAt ?? new Date().toISOString(),
    expiresAt: over.expiresAt ?? null,
  };
}

function postedTexts(): string[] {
  return h.store.slackPosts.map((p) => p.text);
}

beforeEach(() => {
  h.reset();
});

describe("per-session scoped outage arc", () => {
  it("opens a session-scoped incident and posts detection to the session channel", async () => {
    h.store.sessions = [session({ id: "sess-a", slackChannel: "#team-a" })];

    await runDemoSessionsTick();

    expect(h.store.incidents).toHaveLength(1);
    const inc = h.store.incidents[0];
    expect(isSessionScopedIncident(inc)).toBe(true);
    expect(demoSessionIdOfIncident(inc)).toBe("sess-a");
    // Detection routed to the session's channel.
    const detection = h.store.slackPosts.find((p) => p.text === "detection");
    expect(detection?.channel).toBe("#team-a");
  });

  it("quiet mode (runFullArc false) opens no incident and posts nothing", async () => {
    h.store.sessions = [session({ id: "sess-quiet", runFullArc: false })];

    await runDemoSessionsTick();

    expect(h.store.incidents).toHaveLength(0);
    expect(postedTexts()).toHaveLength(0);
  });

  it("launches summarizer + fixer when agents are available and posts the PR", async () => {
    h.store.agentsAvailable = true;
    h.store.agentStatus = {
      status: "finished",
      finalText: "*Impact:* scoped. *Likely cause:* x. *Next step:* y.",
      prUrl: "https://github.com/flylo-air/booking-backend/pull/42",
      prNumber: 42,
    };
    h.store.sessions = [session({ id: "sess-b", slackChannel: "C0999" })];

    // First tick: detect + launch agents.
    await runDemoSessionsTick();
    expect(h.store.launches.summarizer).toBe(1);
    expect(h.store.launches.fixer).toBe(1);

    // Second tick: agents finished -> summary + PR posted, PR labelled.
    await runDemoSessionsTick();
    const texts = postedTexts();
    expect(texts.some((t) => t.startsWith("summary:"))).toBe(true);
    expect(texts.some((t) => t.startsWith("pr:"))).toBe(true);
    expect(h.store.labels).toContain(42);
    // Everything routed to the session channel.
    expect(h.store.slackPosts.every((p) => p.channel === "C0999")).toBe(true);
    // Still one incident for the session (no loop).
    expect(h.store.incidents).toHaveLength(1);
  });

  it("degraded local mode (no agents) posts a simulated summary", async () => {
    h.store.agentsAvailable = false;
    h.store.sessions = [session({ id: "sess-c" })];

    await runDemoSessionsTick();

    expect(h.store.launches.summarizer).toBe(0);
    expect(postedTexts().some((t) => t.startsWith("summary:"))).toBe(true);
    expect(h.store.incidents[0].summaryPosted).toBe(true);
  });

  it("recovers an open incident once the session leaves the active list", async () => {
    h.store.sessions = [session({ id: "sess-d", slackChannel: "#team-d" })];
    await runDemoSessionsTick();
    expect(h.store.incidents[0].status).toBe("open");

    // Session ends (presenter resolved, or TTL expired on the backend).
    h.store.sessions = [];
    await runDemoSessionsTick();

    const inc = h.store.incidents[0];
    expect(inc.status).toBe("resolved");
    expect(inc.resolvedAt).not.toBeNull();
    expect(inc.events.map((e) => e.kind)).toContain("recovered");
    // Recovery routed back to the original channel captured at detection.
    const recovery = h.store.slackPosts.find((p) => p.text === "recovery");
    expect(recovery?.channel).toBe("#team-d");
  });

  it("keeps two sessions independent (one incident each, correct channels)", async () => {
    h.store.sessions = [
      session({ id: "sess-1", slackChannel: "#a" }),
      session({ id: "sess-2", slackChannel: "#b" }),
    ];

    await runDemoSessionsTick();

    expect(h.store.incidents).toHaveLength(2);
    const ids = h.store.incidents.map(demoSessionIdOfIncident).sort();
    expect(ids).toEqual(["sess-1", "sess-2"]);
    const channels = h.store.slackPosts
      .filter((p) => p.text === "detection")
      .map((p) => p.channel)
      .sort();
    expect(channels).toEqual(["#a", "#b"]);
  });

  it("does not re-open a resolved session incident (no loop) even if session lingers", async () => {
    h.store.sessions = [session({ id: "sess-e" })];
    await runDemoSessionsTick(); // opens
    h.store.sessions = []; // leaves
    await runDemoSessionsTick(); // resolves
    expect(h.store.incidents[0].status).toBe("resolved");

    // The same id reappears active (should not happen in practice): still only
    // the single already-resolved incident, never a fresh one.
    h.store.sessions = [session({ id: "sess-e" })];
    await runDemoSessionsTick();
    expect(h.store.incidents).toHaveLength(1);
    expect(h.store.incidents[0].status).toBe("resolved");
  });
});
