import "server-only";

import { getSlackWebhookUrl } from "./config";

// Slack incoming-webhook poster. Best effort: a Slack failure must never break
// the orchestrator tick. When no webhook is configured (local dev) posts are
// logged to the server console so the flow is still observable.

export type SlackPost = {
  text: string;
  blocks?: unknown[];
};

export async function postSlack(post: SlackPost): Promise<boolean> {
  const url = getSlackWebhookUrl();
  if (!url) {
    console.log("[ops/slack] (no webhook configured)\n" + post.text);
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(post),
    });
    if (!res.ok) {
      console.warn("[ops/slack] post failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[ops/slack] post error", err);
    return false;
  }
}

// A terse detection ping, sent the moment an incident opens.
export function detectionBlocks(errorRate: number): SlackPost {
  const text = `:rotating_light: *FlyLo booking API incident*: elevated 5xx errors on the pricing path (${errorRate} in the last few minutes). Investigating automatically.`;
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "FlyLo Ops · autonomous incident response",
          },
        ],
      },
    ],
  };
}

// The exec-readable incident summary produced by the summarizer agent.
export function summaryBlocks(summary: string): SlackPost {
  return {
    text: summary,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Incident summary", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: summary.slice(0, 2900) },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "Drafted by a Cursor cloud agent" },
        ],
      },
    ],
  };
}

export function prBlocks(prUrl: string, prNumber: number): SlackPost {
  const text = `:wrench: Fix PR opened for review by a Cursor cloud agent: <${prUrl}|booking-backend #${prNumber}>. Service is being mitigated by disabling the fuel-surcharge feature flag; the PR is the durable code fix.`;
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
    ],
  };
}

export function recoveryBlocks(): SlackPost {
  const text = ":white_check_mark: *Booking API recovered.* Pricing endpoints healthy again after the fuel-surcharge feature flag was disabled.";
  return {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

// --- Transient / degraded-performance scenario (benign) --------------------
// These are deliberately measured and calm. The booking site stays up; this is
// a "looks slightly off, investigating" beat, not an alarming outage ping.

// A measured detection ping for the benign degraded-performance scenario.
export function spikeDetectedBlocks(): SlackPost {
  const text =
    ":mag: *Booking API: elevated latency observed.* Responses are a little slower than usual. The site is up and serving requests. Investigating automatically; no action needed yet.";
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "FlyLo Ops · automated performance check",
          },
        ],
      },
    ],
  };
}

// The investigation conclusion for the transient scenario. The narrative beat:
// an agent looked into it and concluded it is benign, nothing to fix.
export function spikeInvestigationBlocks(assessment: string): SlackPost {
  return {
    text: assessment,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Performance check: no action needed", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: assessment.slice(0, 2900) },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "Assessed by a Cursor cloud agent" },
        ],
      },
    ],
  };
}

export function spikeRecoveredBlocks(): SlackPost {
  const text =
    ":white_check_mark: *Booking API latency back to normal.* Resolved: the degradation was transient, no action was needed.";
  return {
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}
