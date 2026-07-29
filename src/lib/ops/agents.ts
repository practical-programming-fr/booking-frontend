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
- Open a pull request with a clear title and a short description of the root cause and the fix.`;

const INVESTIGATOR_PROMPT = (errors: OpsError[]) => `You are the on-call engineer for FlyLo, a premium airline. Monitoring flagged elevated latency (slower-than-usual responses) on the production booking API (repo ${getFixRepo()}). The site is UP and serving requests; this is a performance blip, not an outage. Customers are not being turned away.

Recent signals captured from production:

${formatErrorSamples(errors)}

Investigate briefly and decide whether this is a real problem that needs a code change, or a transient blip (for example a short traffic burst or a slow downstream call) that clears on its own. Do NOT open a pull request and do NOT change any code. Your final message must be a short assessment, formatted as:

*What we saw:* one sentence on the symptom.
*Assessment:* one or two sentences on the likely cause and whether it is transient.
*Recommendation:* one sentence. In the common transient case this is "no action needed; monitoring".

Keep it under 90 words and written for a non-engineer audience.`;

// Launch a single investigator for the benign transient scenario. It reuses the
// same cloud-agent launch mechanism as the summarizer (autoCreatePR: false), so
// it can never open a PR. It only produces a short assessment.
export async function launchInvestigator(errors: OpsError[]): Promise<string> {
  const { Agent } = await loadSdk();
  const model = await resolveModel();
  const agent = await Agent.create({
    apiKey: getCursorApiKey(),
    name: `FlyLo latency investigator · ${new Date().toISOString()}`,
    model,
    cloud: {
      repos: [{ url: `https://github.com/${getFixRepo()}`, startingRef: FIX_STARTING_REF }],
      autoCreatePR: false,
    },
  });
  await agent.send(INVESTIGATOR_PROMPT(errors), { model });
  return agent.agentId;
}

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

// --- GitHub (PR merge detection for the timeline) --------------------------

let octokit: Octokit | null = null;

function getOctokit(): Octokit | null {
  const token = getGithubToken();
  if (!token) return null;
  octokit ??= new Octokit({ auth: token, userAgent: "flylo-ops-console" });
  return octokit;
}

// Tag the fix PR so the nightly demo-cleanup workflow can find and close it.
// These PRs are never merged (the demo recovers via the flag), so labelling
// them keeps housekeeping trivial. Best effort.
export async function addDemoLabel(prNumber: number): Promise<void> {
  const client = getOctokit();
  if (!client) return;
  try {
    const { owner, repo } = getFixRepoParts();
    await client.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels: ["demo"],
    });
  } catch {
    // ignore: labelling is best effort
  }
}
