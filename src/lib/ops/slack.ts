import "server-only";

import {
  getSlackAutoCreateChannel,
  getSlackBotToken,
  getSlackDefaultChannel,
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
  // Timestamp of the root Slack message. Replies stay inside that thread.
  threadTs?: string | null;
};

export type SlackMessageRef = {
  channel: string;
  ts: string;
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

async function postViaWebhook(
  post: SlackPost,
  threadTs?: string,
): Promise<boolean> {
  const url = getSlackWebhookUrl();
  if (!url) {
    console.log("[ops/slack] (no webhook configured)\n" + post.text);
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...post,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }),
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

type SlackApiResponse = {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
};

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
  threadTs?: string,
): Promise<SlackMessageRef | null> {
  try {
    const target = await resolveChannelForBot(token, channel);
    const resp = await slackApi("chat.postMessage", token, {
      channel: target,
      text: post.text,
      blocks: post.blocks,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    if (!resp.ok) {
      console.warn("[ops/slack] chat.postMessage failed:", resp.error);
      return null;
    }
    return resp.channel && resp.ts
      ? { channel: resp.channel, ts: resp.ts }
      : null;
  } catch (err) {
    console.warn("[ops/slack] chat.postMessage error", err);
    return null;
  }
}

type SlackSendResult =
  | { ok: true; ref: SlackMessageRef | null }
  | { ok: false; ref: null };

async function sendSlack(
  post: SlackPost,
  options: SlackPostOptions = {},
): Promise<SlackSendResult> {
  const requestedChannel = options.channel?.trim() || undefined;
  const botToken = getSlackBotToken();
  const channel = requestedChannel ?? (botToken ? getSlackDefaultChannel() : undefined);
  const threadTs = options.threadTs?.trim() || undefined;

  // Bot posts return the channel and timestamp needed for thread replies.
  if (channel && botToken) {
    const ref = await postViaBot(botToken, channel, post, threadTs);
    if (ref) return { ok: true, ref };
    const fallbackPost = requestedChannel
      ? withChannelNote(post, requestedChannel)
      : post;
    const ok = await postViaWebhook(fallbackPost, threadTs);
    return ok ? { ok: true, ref: null } : { ok: false, ref: null };
  }

  // A channel was requested but we have no bot token: post to the single
  // webhook channel and note where it was meant to go.
  if (requestedChannel && !botToken) {
    const ok = await postViaWebhook(
      withChannelNote(post, requestedChannel),
      threadTs,
    );
    return ok ? { ok: true, ref: null } : { ok: false, ref: null };
  }

  // No channel (global path): original single-channel webhook behavior.
  const ok = await postViaWebhook(post, threadTs);
  return ok ? { ok: true, ref: null } : { ok: false, ref: null };
}

export async function postSlack(
  post: SlackPost,
  options: SlackPostOptions = {},
): Promise<boolean> {
  return (await sendSlack(post, options)).ok;
}

export async function postSlackWithRef(
  post: SlackPost,
  options: SlackPostOptions = {},
): Promise<SlackMessageRef | null> {
  const result = await sendSlack(post, options);
  return result.ref;
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

export function cursorAgentUrl(agentId: string): string {
  return `https://cursor.com/agents/${encodeURIComponent(agentId)}`;
}

function agentCredit(label: string, agentId?: string | null): string {
  return agentId
    ? `${label} · <${cursorAgentUrl(agentId)}|View investigation>`
    : label;
}

// The exec-readable incident summary produced by the summarizer agent.
export function summaryBlocks(
  summary: string,
  agentId?: string | null,
): SlackPost {
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
          {
            type: "mrkdwn",
            text: agentCredit("Drafted by a Cursor cloud agent", agentId),
          },
        ],
      },
    ],
  };
}

export function prBlocks(
  prUrl: string,
  prNumber: number,
  agentId?: string | null,
): SlackPost {
  const investigation = agentId
    ? ` <${cursorAgentUrl(agentId)}|View Cursor investigation>.`
    : "";
  const text = `:wrench: Fix PR opened for review by a Cursor cloud agent: <${prUrl}|booking-backend #${prNumber}>.${investigation} Service is being mitigated by disabling the fuel-surcharge feature flag; the PR is the durable code fix.`;
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
