import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Run, RunResult } from "@cursor/sdk";

const listRuns = vi.fn();
const getRun = vi.fn();

vi.mock("@cursor/sdk", () => ({
  Agent: {
    listRuns: (...args: unknown[]) => listRuns(...args),
    getRun: (...args: unknown[]) => getRun(...args),
  },
}));

function mockRun(over: Partial<Run> & Pick<Run, "id" | "agentId" | "status">): Run {
  const wait = over.wait ?? vi.fn();
  return {
    requestId: undefined,
    supports: (op: string) => op === "wait" || op === "stream" || op === "cancel",
    unsupportedReason: () => undefined,
    stream: vi.fn(),
    conversation: vi.fn(),
    cancel: vi.fn(),
    onDidChangeStatus: () => () => {},
    result: undefined,
    git: undefined,
    ...over,
    wait,
  } as Run;
}

describe("getAgentStatus", () => {
  beforeEach(() => {
    listRuns.mockReset();
    getRun.mockReset();
    process.env.CURSOR_API_KEY = "test-key";
  });

  it("returns running without calling wait when the latest run is still active", async () => {
    const run = mockRun({
      id: "run-11111111-1111-4111-8111-111111111111",
      agentId: "bc-11111111-1111-4111-8111-111111111111",
      status: "running",
    });
    listRuns.mockResolvedValue({ items: [run] });
    getRun.mockResolvedValue(run);

    const { getAgentStatus } = await import("@/lib/ops/agents");
    const status = await getAgentStatus(run.agentId);

    expect(status).toEqual({
      status: "running",
      finalText: null,
      prUrl: null,
      prNumber: null,
    });
    expect(run.wait).not.toHaveBeenCalled();
  });

  it("hydrates finalText from getRun when listRuns omits result metadata", async () => {
    const sparse = mockRun({
      id: "run-22222222-2222-4222-8222-222222222222",
      agentId: "bc-22222222-2222-4222-8222-222222222222",
      status: "finished",
    });
    const hydrated = mockRun({
      id: sparse.id,
      agentId: sparse.agentId,
      status: "finished",
      result: "*Impact:* Customers could not book.",
    });
    listRuns.mockResolvedValue({ items: [sparse] });
    getRun.mockResolvedValue(hydrated);

    const { getAgentStatus } = await import("@/lib/ops/agents");
    const status = await getAgentStatus(sparse.agentId);

    expect(getRun).toHaveBeenCalledWith(sparse.id, {
      runtime: "cloud",
      agentId: sparse.agentId,
      apiKey: "test-key",
    });
    expect(status.status).toBe("finished");
    expect(status.finalText).toBe("*Impact:* Customers could not book.");
    expect(sparse.wait).not.toHaveBeenCalled();
  });

  it("falls back to run.wait() when getRun still lacks result and pr metadata", async () => {
    const sparse = mockRun({
      id: "run-33333333-3333-4333-8333-333333333333",
      agentId: "bc-33333333-3333-4333-8333-333333333333",
      status: "finished",
    });
    const waitResult: RunResult = {
      id: sparse.id,
      status: "finished",
      result: "Summary from wait()",
      git: {
        branches: [{ repoUrl: "https://github.com/org/repo", prUrl: "https://github.com/org/repo/pull/42" }],
      },
    };
    sparse.wait = vi.fn().mockResolvedValue(waitResult);
    listRuns.mockResolvedValue({ items: [sparse] });
    getRun.mockResolvedValue(sparse);

    const { getAgentStatus } = await import("@/lib/ops/agents");
    const status = await getAgentStatus(sparse.agentId);

    expect(sparse.wait).toHaveBeenCalledTimes(1);
    expect(status.finalText).toBe("Summary from wait()");
    expect(status.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(status.prNumber).toBe(42);
  });
});
