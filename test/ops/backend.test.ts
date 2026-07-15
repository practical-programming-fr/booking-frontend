import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lock the two backend contract points: the demo-session DELETE route (path
// param, with a POST /end fallback) and mapping the GET list shape onto the
// fields the orchestrator reads (slackChannel, runFullArc).

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];

function mockFetch(handler: (url: string, method: string) => { ok: boolean; json?: unknown }) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = handler(String(url), method);
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      statusText: r.ok ? "OK" : "Error",
      text: async () => "",
      json: async () => r.json ?? { ok: r.ok },
    } as unknown as Response;
  });
}

const { deactivateDemoSession, listDemoSessions, normalizeDemoSession } =
  await import("@/lib/ops/backend");

beforeEach(() => {
  calls.length = 0;
  process.env.BOOKING_API_URL = "http://backend.test";
  delete process.env.OPS_SHARED_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deactivateDemoSession route", () => {
  it("DELETEs with the id as a path param, no query and no body", async () => {
    mockFetch(() => ({ ok: true, json: { ok: true } }));

    await deactivateDemoSession("sess-1");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("http://backend.test/v1/_ops/demo-sessions/sess-1");
    expect(calls[0].url).not.toContain("?");
    expect(calls[0].body).toBeUndefined();
  });

  it("falls back to POST /:id/end when the DELETE fails", async () => {
    mockFetch((_url, method) => ({ ok: method !== "DELETE" }));

    await deactivateDemoSession("sess-2");

    expect(calls[0].method).toBe("DELETE");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].url).toBe(
      "http://backend.test/v1/_ops/demo-sessions/sess-2/end",
    );
  });
});

describe("demo session list shape mapping", () => {
  it("maps the confirmed GET keys (sessionId, slackChannel, runFullArc)", async () => {
    mockFetch(() => ({
      ok: true,
      json: {
        sessions: [
          {
            sessionId: "abc",
            slackChannel: "#team-a",
            runFullArc: true,
            expiresAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            kind: "outage",
          },
        ],
      },
    }));

    const sessions = await listDemoSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("abc");
    expect(sessions[0].slackChannel).toBe("#team-a");
    expect(sessions[0].runFullArc).toBe(true);
    // GET only lists active sessions, so absence of an active flag reads active.
    expect(sessions[0].active).toBe(true);
  });

  it("accepts snake_case slack_channel / run_full_arc defensively", () => {
    const s = normalizeDemoSession({
      sessionId: "xyz",
      slack_channel: "C123",
      run_full_arc: false,
    });
    expect(s?.slackChannel).toBe("C123");
    expect(s?.runFullArc).toBe(false);
  });
});
