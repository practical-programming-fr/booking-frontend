import { beforeEach, describe, expect, it, vi } from "vitest";

// Controllable fake for the Octokit issues API. Every test drives these mocks.
const issues = {
  getLabel: vi.fn(),
  createLabel: vi.fn(),
  addLabels: vi.fn(),
  listLabelsOnIssue: vi.fn(),
};

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    issues = issues;
  },
}));

function httpError(status: number): Error & { status: number } {
  const err = new Error(`HTTP ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

const labelPresent = () => ({ data: [{ name: "demo" }] });
const labelAbsent = () => ({ data: [] as { name: string }[] });

// addDemoLabel memoizes its Octokit, so reset the module between tests to get a
// clean client and avoid cross-test bleed. The fast option overrides keep the
// backoff sleeps near-instant.
async function loadAgents() {
  vi.resetModules();
  return import("@/lib/ops/agents");
}

const FAST = { attempts: 4, baseDelayMs: 0 };
const PR_URL = "https://github.com/flylo-air/booking-backend/pull/123";

beforeEach(() => {
  process.env.GITHUB_TOKEN = "gh-test-token";
  delete process.env.GH_KEY;
  delete process.env.OPS_FIX_REPO;
  for (const fn of Object.values(issues)) fn.mockReset();
});

describe("parsePrUrl", () => {
  it("extracts owner, repo, and number from a PR URL", async () => {
    const { parsePrUrl } = await loadAgents();
    expect(parsePrUrl(PR_URL)).toEqual({
      owner: "flylo-air",
      repo: "booking-backend",
      number: 123,
    });
  });

  it("returns null for a non-PR URL", async () => {
    const { parsePrUrl } = await loadAgents();
    expect(parsePrUrl("https://github.com/flylo-air/booking-backend")).toBeNull();
  });
});

describe("addDemoLabel", () => {
  it("labels the PR in the repo taken from the PR URL, not OPS_FIX_REPO", async () => {
    process.env.OPS_FIX_REPO = "flylo-air/some-other-repo";
    issues.getLabel.mockResolvedValue({ data: { name: "demo" } });
    issues.addLabels.mockResolvedValue({});
    issues.listLabelsOnIssue.mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    const ok = await addDemoLabel(PR_URL, 123, FAST);

    expect(ok).toBe(true);
    expect(issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "flylo-air",
        repo: "booking-backend",
        issue_number: 123,
        labels: ["demo"],
      }),
    );
  });

  it("creates the 'demo' label when it does not exist, then labels the PR", async () => {
    issues.getLabel.mockRejectedValue(httpError(404));
    issues.createLabel.mockResolvedValue({});
    issues.addLabels.mockResolvedValue({});
    issues.listLabelsOnIssue.mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    const ok = await addDemoLabel(PR_URL, 123, FAST);

    expect(ok).toBe(true);
    expect(issues.createLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "demo" }),
    );
  });

  it("tolerates a racing label creation (422 already exists)", async () => {
    issues.getLabel.mockRejectedValue(httpError(404));
    issues.createLabel.mockRejectedValue(httpError(422));
    issues.addLabels.mockResolvedValue({});
    issues.listLabelsOnIssue.mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    expect(await addDemoLabel(PR_URL, 123, FAST)).toBe(true);
  });

  it("retries a transient add failure, then succeeds", async () => {
    issues.getLabel.mockResolvedValue({ data: { name: "demo" } });
    issues.addLabels
      .mockRejectedValueOnce(httpError(502))
      .mockResolvedValue({});
    issues.listLabelsOnIssue.mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    const ok = await addDemoLabel(PR_URL, 123, FAST);

    expect(ok).toBe(true);
    expect(issues.addLabels).toHaveBeenCalledTimes(2);
  });

  it("retries when the label is not present after the add, then verifies", async () => {
    issues.getLabel.mockResolvedValue({ data: { name: "demo" } });
    issues.addLabels.mockResolvedValue({});
    issues.listLabelsOnIssue
      .mockResolvedValueOnce(labelAbsent())
      .mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    const ok = await addDemoLabel(PR_URL, 123, FAST);

    expect(ok).toBe(true);
    expect(issues.addLabels).toHaveBeenCalledTimes(2);
  });

  it("throws DemoLabelError loudly after exhausting retries", async () => {
    issues.getLabel.mockResolvedValue({ data: { name: "demo" } });
    issues.addLabels.mockRejectedValue(httpError(403));

    const { addDemoLabel, DemoLabelError } = await loadAgents();
    await expect(addDemoLabel(PR_URL, 123, FAST)).rejects.toBeInstanceOf(
      DemoLabelError,
    );
    expect(issues.addLabels).toHaveBeenCalledTimes(4);
  });

  it("resolves owner/repo/number from the URL even when prNumber is null", async () => {
    issues.getLabel.mockResolvedValue({ data: { name: "demo" } });
    issues.addLabels.mockResolvedValue({});
    issues.listLabelsOnIssue.mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    const ok = await addDemoLabel(PR_URL, null, FAST);

    expect(ok).toBe(true);
    expect(issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 123 }),
    );
  });

  it("falls back to OPS_FIX_REPO + number when the URL is unparseable", async () => {
    process.env.OPS_FIX_REPO = "flylo-air/booking-backend";
    issues.getLabel.mockResolvedValue({ data: { name: "demo" } });
    issues.addLabels.mockResolvedValue({});
    issues.listLabelsOnIssue.mockResolvedValue(labelPresent());

    const { addDemoLabel } = await loadAgents();
    const ok = await addDemoLabel("not-a-pr-url", 55, FAST);

    expect(ok).toBe(true);
    expect(issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "flylo-air",
        repo: "booking-backend",
        issue_number: 55,
      }),
    );
  });

  it("returns false (not an error) when no GITHUB_TOKEN is configured", async () => {
    delete process.env.GITHUB_TOKEN;
    const { addDemoLabel } = await loadAgents();
    expect(await addDemoLabel(PR_URL, 123, FAST)).toBe(false);
    expect(issues.addLabels).not.toHaveBeenCalled();
  });

  it("throws when neither a parseable URL nor a number is available", async () => {
    delete process.env.OPS_FIX_REPO;
    const { addDemoLabel, DemoLabelError } = await loadAgents();
    await expect(addDemoLabel(null, null, FAST)).rejects.toBeInstanceOf(
      DemoLabelError,
    );
  });
});
