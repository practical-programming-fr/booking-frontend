import "server-only";

import type { ModelSelection, Run, RunResult, RunStatus, SDKModel } from "@cursor/sdk";
import { Octokit } from "@octokit/rest";
import {
  getCursorApiKey,
  getFixRepo,
  getFixRepoParts,
  getGithubToken,
  getOpsAgentModel,
} from "./config";
import type { OpsError } from "./types";

type CursorSdk = typeof import("@cursor/sdk");

const FIX_STARTING_REF = "main";

// A stable, unique marker the fixer is asked to place in the PR body. It lets
// the nightly demo-cleanup match FlyLo outage-demo fix PRs even if the `demo`
// label somehow never lands, WITHOUT risking unrelated PRs: the string is
// specific to this demo and appears nowhere else. Labelling remains the primary
// signal; this is belt-and-suspenders for the cleanup side.
export const DEMO_PR_MARKER = "<!-- flylo-outage-demo-fix -->";

export function agentsAvailable(): boolean {
  return Boolean(getCursorApiKey());
}

async function loadSdk(): Promise<CursorSdk> {
  return import("@cursor/sdk");
}

async function resolveModel(): Promise<ModelSelection> {
  const { Cursor } = await loadSdk();
  const models: SDKModel[] = await Cursor.models.list({ apiKey: getCursorApiKey() });
  const preferredId = getOpsAgentModel();
  const requested = preferredId ? models.find((m) => m.id === preferredId) : undefined;
  const fallback =
    models.find((m) => m.variants?.some((v) => v.isDefault)) ?? models[0];
  const model = requested ?? fallback;
  if (!model) {
    throw new Error("No Cursor model available for this API key");
  }
  const variant = model.variants?.find((v) => v.isDefault) ?? model.variants?.[0];
  return variant?.params?.length
    ? { id: model.id, params: variant.params }
    : { id: model.id };
}

function formatErrorSamples(errors: OpsError[], limit = 5): string {
  const sample = errors.slice(0, limit);
  if (sample.length === 0) return "(no error samples captured)";
  return sample
    .map((e) => {
      const stackHead = e.stack
        ? e.stack.split("\n").slice(0, 6).join("\n")
        : "(no stack)";
      return `- ${e.method} ${e.path} -> ${e.status}\n  ${e.message}\n${stackHead}`;
    })
    .join("\n\n");
}

const SUMMARIZER_PROMPT = (errors: OpsError[]) => `You are the on-call incident responder for FlyLo, a premium airline. The production booking API (repo ${getFixRepo()}) is returning HTTP 500 errors on its pricing endpoints right now. Customers cannot search flights or book.

Here are real error samples captured from production in the last few minutes:

${formatErrorSamples(errors)}

Investigate the repository to understand the likely root cause, then write a concise, exec-readable incident summary. Do NOT open a pull request and do NOT change any code. Your final message must be the summary itself, formatted as:

*Impact:* one sentence on customer-facing impact.
*Likely cause:* one or two sentences, plain language, referencing the specific code path.
*Next step:* one sentence on the fix in flight.

Keep the whole summary under 120 words. Write for a non-engineer executive audience.`;

const FIXER_PROMPT = (errors: OpsError[]) => `You are an on-call engineer for FlyLo. The production booking API (repo ${getFixRepo()}) is throwing HTTP 500 errors on its pricing endpoints (flight search, flight detail, and booking creation). Customers are affected right now.

Real error samples from production:

${formatErrorSamples(errors)}

Find and fix the root-cause bug so the pricing endpoints return 200 again. Requirements:
- Fix forward with the smallest correct change. Do not delete or disable the fuel surcharge feature, and do not turn off any feature flag or environment toggle. The surcharge must still be applied correctly once fixed.
- Keep the change scoped to the pricing/fare code; do not refactor unrelated files.
- Add or update a focused unit test that would catch this regression if you can do so quickly.
- Open a pull request with a clear title and a short description of the root cause and the fix.
- Include this exact marker on its own line at the very top of the PR description so demo housekeeping can identify this PR: ${DEMO_PR_MARKER}`;

export async function launchSummarizer(errors: OpsError[]): Promise<string> {
  const { Agent } = await loadSdk();
  const model = await resolveModel();
  const agent = await Agent.create({
    apiKey: getCursorApiKey(),
    name: `FlyLo incident summarizer · ${new Date().toISOString()}`,
    model,
    cloud: {
      repos: [{ url: `https://github.com/${getFixRepo()}`, startingRef: FIX_STARTING_REF }],
      autoCreatePR: false,
    },
  });
  await agent.send(SUMMARIZER_PROMPT(errors), { model });
  return agent.agentId;
}

export async function launchFixer(errors: OpsError[]): Promise<string> {
  const { Agent } = await loadSdk();
  const model = await resolveModel();
  const agent = await Agent.create({
    apiKey: getCursorApiKey(),
    name: `FlyLo incident fixer · ${new Date().toISOString()}`,
    model,
    cloud: {
      repos: [{ url: `https://github.com/${getFixRepo()}`, startingRef: FIX_STARTING_REF }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  });
  await agent.send(FIXER_PROMPT(errors), { model });
  return agent.agentId;
}

async function getLatestRun(agentId: string): Promise<Run | null> {
  const { Agent } = await loadSdk();
  const result = await Agent.listRuns(agentId, {
    runtime: "cloud",
    apiKey: getCursorApiKey(),
    limit: 1,
  });
  return result.items[0] ?? null;
}

export type AgentStatus = {
  status: "running" | "finished" | "error" | "cancelled" | "unknown";
  finalText: string | null;
  prUrl: string | null;
  prNumber: number | null;
};

function extractFinalTextFromResult(result?: string | null): string | null {
  if (result?.trim()) return result.trim();
  return null;
}

function extractFinalText(run: Run): string | null {
  return extractFinalTextFromResult(run.result);
}

function extractPrFromGit(
  git: Run["git"] | RunResult["git"] | undefined,
): { prUrl: string | null; prNumber: number | null } {
  const branches = git?.branches ?? [];
  for (const b of branches) {
    if (b.prUrl) {
      const match = /\/pull\/(\d+)/.exec(b.prUrl);
      return { prUrl: b.prUrl, prNumber: match ? Number(match[1]) : null };
    }
  }
  return { prUrl: null, prNumber: null };
}

function extractPr(run: Run): { prUrl: string | null; prNumber: number | null } {
  return extractPrFromGit(run.git);
}

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["finished", "error", "cancelled"]);

function runPayloadComplete(run: Run): boolean {
  return Boolean(extractFinalText(run) || extractPr(run).prUrl);
}

async function fetchCloudRun(run: Run): Promise<Run> {
  const { Agent } = await loadSdk();
  try {
    return await Agent.getRun(run.id, {
      runtime: "cloud",
      agentId: run.agentId,
      apiKey: getCursorApiKey(),
    });
  } catch {
    return run;
  }
}

/** Cloud listRuns snapshots may omit result/git until getRun or wait hydrates them. */
async function hydrateRunMetadata(run: Run): Promise<Run | RunResult> {
  let current = run;

  if (current.status === "running") {
    current = await fetchCloudRun(current);
    if (current.status === "running") {
      return current;
    }
  }

  if (!TERMINAL_RUN_STATUSES.has(current.status)) {
    return current;
  }

  if (!runPayloadComplete(current)) {
    current = await fetchCloudRun(current);
  }

  if (!runPayloadComplete(current) && current.supports("wait")) {
    try {
      return await current.wait();
    } catch {
      return current;
    }
  }

  return current;
}

function agentStatusFromHydrated(hydrated: Run | RunResult): AgentStatus {
  const status = hydrated.status as AgentStatus["status"];
  const finalText = extractFinalTextFromResult(hydrated.result);
  const { prUrl, prNumber } = extractPrFromGit(hydrated.git);
  return { status: status ?? "unknown", finalText, prUrl, prNumber };
}

export async function getAgentStatus(agentId: string): Promise<AgentStatus> {
  const run = await getLatestRun(agentId);
  if (!run) {
    return { status: "unknown", finalText: null, prUrl: null, prNumber: null };
  }
  const hydrated = await hydrateRunMetadata(run);
  return agentStatusFromHydrated(hydrated);
}

// --- GitHub (PR labelling + merge detection for the timeline) --------------

let octokit: Octokit | null = null;

function getOctokit(): Octokit | null {
  const token = getGithubToken();
  if (!token) return null;
  octokit ??= new Octokit({ auth: token, userAgent: "flylo-ops-console" });
  return octokit;
}

// The label the nightly demo-cleanup workflow selects on to find and close the
// fix PRs. Keep this in sync with the cleanup workflow's selector.
export const DEMO_LABEL = "demo";
const DEMO_LABEL_COLOR = "5319e7";
const DEMO_LABEL_DESCRIPTION =
  "FlyLo outage-demo fix PR. Closed automatically by the nightly demo-cleanup.";

// Raised when the fix PR could not be labelled `demo`. The caller records this
// loudly on the incident timeline and in the logs so a PR that the nightly
// cleanup cannot see never fails silently.
export class DemoLabelError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DemoLabelError";
  }
}

type PrRef = { owner: string; repo: string; number: number };

// Pull owner/repo/number out of a GitHub PR URL, e.g.
// https://github.com/flylo-air/booking-backend/pull/123 . This is the
// authoritative source for WHICH repo the PR lives in, so labelling always
// targets the repo the agent actually opened the PR against rather than
// assuming OPS_FIX_REPO.
export function parsePrUrl(prUrl: string): PrRef | null {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i.exec(prUrl);
  if (!m) return null;
  const n = Number(m[3]);
  if (!Number.isInteger(n) || n <= 0) return null;
  return { owner: m[1], repo: m[2], number: n };
}

// Resolve the PR to label from the URL first (authoritative for the repo), then
// fall back to OPS_FIX_REPO + the passed number when the URL is unparseable.
function resolvePrRef(prUrl: string | null, prNumber: number | null): PrRef | null {
  if (prUrl) {
    const fromUrl = parsePrUrl(prUrl);
    if (fromUrl) return fromUrl;
  }
  if (prNumber && Number.isInteger(prNumber) && prNumber > 0) {
    try {
      const { owner, repo } = getFixRepoParts();
      return { owner, repo, number: prNumber };
    } catch {
      return null;
    }
  }
  return null;
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | undefined)?.status;
  return typeof s === "number" ? s : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Make sure the `demo` label exists in the target repo before we try to attach
// it. GitHub's "add labels to an issue" endpoint does not create missing
// labels, so a repo that has never seen the label (a freshly reset demo repo,
// or one where the label was pruned) would otherwise fail every time. Creating
// it is idempotent: a concurrent create (422) is treated as success.
async function ensureDemoLabelExists(
  client: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    await client.issues.getLabel({ owner, repo, name: DEMO_LABEL });
    return;
  } catch (err) {
    if (statusOf(err) !== 404) {
      throw new DemoLabelError(
        `Could not check for the '${DEMO_LABEL}' label in ${owner}/${repo}`,
        { cause: err },
      );
    }
  }
  try {
    await client.issues.createLabel({
      owner,
      repo,
      name: DEMO_LABEL,
      color: DEMO_LABEL_COLOR,
      description: DEMO_LABEL_DESCRIPTION,
    });
  } catch (err) {
    // 422 == already exists (created by a racing tick between our get and
    // create). Anything else is a real failure.
    if (statusOf(err) !== 422) {
      throw new DemoLabelError(
        `Could not create the '${DEMO_LABEL}' label in ${owner}/${repo}`,
        { cause: err },
      );
    }
  }
}

async function labelPresentOnPr(
  client: Octokit,
  ref: PrRef,
): Promise<boolean> {
  const { data } = await client.issues.listLabelsOnIssue({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.number,
    per_page: 100,
  });
  return data.some((l) => l.name === DEMO_LABEL);
}

// Attach the `demo` label to the fix PR reliably so the nightly demo-cleanup
// workflow can find and close it. The PRs are never merged (the demo recovers
// via the flag), so the label is the ONLY signal cleanup has.
//
// Reliability, in order:
//   1. Target the repo from the PR URL (not an assumed OPS_FIX_REPO).
//   2. Create the `demo` label in that repo if it does not exist.
//   3. Add the label, retrying transient/racey failures with backoff.
//   4. Verify the label actually landed on the PR; retry if it did not.
//   5. Fail LOUDLY (throw DemoLabelError) if it still could not be applied, so
//      the caller records it on the timeline instead of swallowing it.
//
// Returns true when the label is confirmed present. Throws DemoLabelError on
// exhausted retries. A missing GITHUB_TOKEN (local/simulated runs) is not an
// error: it returns false so callers can note that labelling was skipped.
export async function addDemoLabel(
  prUrl: string | null,
  prNumber: number | null,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<boolean> {
  const client = getOctokit();
  if (!client) {
    console.warn(
      "[ops] GITHUB_TOKEN not set; cannot label the fix PR 'demo'. Nightly demo-cleanup will not close it automatically.",
    );
    return false;
  }

  const ref = resolvePrRef(prUrl, prNumber);
  if (!ref) {
    throw new DemoLabelError(
      `Cannot label fix PR: no resolvable repo/number (url=${prUrl ?? "null"}, number=${prNumber ?? "null"}).`,
    );
  }

  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await ensureDemoLabelExists(client, ref.owner, ref.repo);
      await client.issues.addLabels({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.number,
        labels: [DEMO_LABEL],
      });
      if (await labelPresentOnPr(client, ref)) {
        return true;
      }
      lastErr = new Error("label not present after add");
    } catch (err) {
      lastErr = err;
    }
    if (attempt < attempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new DemoLabelError(
    `Failed to apply the '${DEMO_LABEL}' label to ${ref.owner}/${ref.repo}#${ref.number} after ${attempts} attempts.`,
    { cause: lastErr },
  );
}
