import "server-only";

import {
  getSlackAutoCreateChannel,
  getSlackBotToken,
  getSlackWebhookUrl,
} from "./config";

// Slack poster. Best effort: a Slack failure must never break the orchestrator
// tick. Two transports, picked automatically:
//
//   1. Bot token (chat.postMessage) when SLACK_BOT_TOKEN is set AND a target
//      channel is supplied. This is how per-session incidents reach a
//      presenter's own channel so a hundred demos do not collide in one shared
//      channel.
//   2. Incoming webhook (SLACK_WEBHOOK_URL) otherwise. This is the original,
//      single-channel behavior. Global-path posts pass no channel, so they keep
//      going to the webhook exactly as before.
//
// Graceful degradation: if a channel is requested but only the webhook is
// configured, we post to the webhook and note the intended channel in the
// message, so nothing is silently dropped. When neither transport is
// configured (local dev) posts are logged to the server console.

export type SlackPost = {
  text: string;
  blocks?: unknown[];
};

export type SlackPostOptions = {
  // Channel id (e.g. C0123ABCD) or channel name (e.g. "incidents" / "#incidents")
  // to route this post to. Only honored when a bot token is configured.
  channel?: string | null;
};

// Note the intended channel inside the message when we cannot actually route to
// it (webhook-only). Keeps the post honest instead of silently landing in the
// default channel with no context.
function withChannelNote(post: SlackPost, channel: string): SlackPost {
  const note = `(intended channel: ${normalizeChannelLabel(channel)})`;
  return {
    text: `${note} ${post.text}`,
    blocks: [
      ...(post.blocks ?? []),
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: note }],
      },
    ],
  };
}

function normalizeChannelLabel(channel: string): string {
  const c = channel.trim();
  if (!c) return c;
  // Channel ids start with C/G/D; leave them as-is. Names get a leading #.
  if (/^[CGD][A-Z0-9]{6,}$/.test(c)) return c;
  return c.startsWith("#") ? c : `#${c}`;
}

async function postViaWebhook(post: SlackPost): Promise<boolean> {
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
      console.warn("[ops/slack] webhook post failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[ops/slack] webhook post error", err);
    return false;
  }
}

type SlackApiResponse = { ok: boolean; error?: string; channel?: string };

async function slackApi(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SlackApiResponse> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SlackApiResponse;
}

// Best-effort auto-create of a channel by name (gated behind
// SLACK_AUTO_CREATE_CHANNEL and needs channels:manage). Returns the channel id
// to post to, or the original value on any failure so posting can still try.
async function resolveChannelForBot(
  token: string,
  channel: string,
): Promise<string> {
  const c = channel.trim().replace(/^#/, "");
  // Looks like a channel id already: use it directly.
  if (/^[CGD][A-Z0-9]{6,}$/.test(channel.trim())) return channel.trim();
  if (!getSlackAutoCreateChannel()) return c;
  try {
    const created = await slackApi("conversations.create", token, { name: c });
    if (created.ok && created.channel) return created.channel;
    if (created.error === "name_taken") {
      // Already exists: chat.postMessage accepts the name, so fall back to it.
      return c;
    }
    console.warn("[ops/slack] conversations.create failed:", created.error);
  } catch (err) {
    console.warn("[ops/slack] conversations.create error", err);
  }
  return c;
}

async function postViaBot(
  token: string,
  channel: string,
  post: SlackPost,
): Promise<boolean> {
  try {
    const target = await resolveChannelForBot(token, channel);
    const resp = await slackApi("chat.postMessage", token, {
      channel: target,
      text: post.text,
      blocks: post.blocks,
    });
    if (!resp.ok) {
      console.warn("[ops/slack] chat.postMessage failed:", resp.error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[ops/slack] chat.postMessage error", err);
    return false;
  }
}

export async function postSlack(
  post: SlackPost,
  options: SlackPostOptions = {},
): Promise<boolean> {
  const channel = options.channel?.trim() || undefined;
  const botToken = getSlackBotToken();

  // Preferred path: a specific channel routed via the bot token.
  if (channel && botToken) {
    const ok = await postViaBot(botToken, channel, post);
    if (ok) return true;
    // Bot post failed: degrade to the webhook so the beat is not lost.
    return postViaWebhook(withChannelNote(post, channel));
  }

  // A channel was requested but we have no bot token: post to the single
  // webhook channel and note where it was meant to go.
  if (channel && !botToken) {
    return postViaWebhook(withChannelNote(post, channel));
  }

  // No channel (global path): original single-channel webhook behavior.
  return postViaWebhook(post);
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
