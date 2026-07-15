import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the transport-selection logic in postSlack: bot token + channel vs
// the single webhook, plus graceful degradation when a channel is requested but
// only the webhook is configured.

type FetchCall = { url: string; body: Record<string, unknown> };

const calls: FetchCall[] = [];

function mockFetch(handler: (url: string) => { ok: boolean; json?: unknown }) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    const r = handler(String(url));
    return {
      ok: r.ok,
      status: r.ok ? 200 : 500,
      text: async () => "",
      json: async () => r.json ?? { ok: r.ok },
    } as unknown as Response;
  });
}

const { postSlack } = await import("@/lib/ops/slack");

beforeEach(() => {
  calls.length = 0;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_WEBHOOK_URL;
  delete process.env.SLACK_AUTO_CREATE_CHANNEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postSlack transport selection", () => {
  it("uses chat.postMessage with the channel when a bot token is set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    mockFetch(() => ({ ok: true, json: { ok: true, channel: "C1" } }));

    const ok = await postSlack({ text: "hi" }, { channel: "C0123ABCD" });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("chat.postMessage");
    expect(calls[0].body.channel).toBe("C0123ABCD");
  });

  it("falls back to the webhook and notes the intended channel when no bot token", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
    mockFetch(() => ({ ok: true }));

    const ok = await postSlack({ text: "hello" }, { channel: "team-a" });

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("hooks.slack.com");
    // The intended channel is noted in the text so the post is not silently lost.
    expect(String(calls[0].body.text)).toContain("intended channel: #team-a");
  });

  it("posts to the webhook unchanged when no channel is supplied (global path)", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
    mockFetch(() => ({ ok: true }));

    const ok = await postSlack({ text: "global" });

    expect(ok).toBe(true);
    expect(calls[0].url).toContain("hooks.slack.com");
    expect(calls[0].body.text).toBe("global");
  });

  it("degrades to the webhook with a note if the bot post fails", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/x";
    mockFetch((url) =>
      url.includes("chat.postMessage")
        ? { ok: true, json: { ok: false, error: "channel_not_found" } }
        : { ok: true },
    );

    const ok = await postSlack({ text: "beat" }, { channel: "missing" });

    expect(ok).toBe(true);
    // First the bot attempt, then the webhook fallback.
    expect(calls[0].url).toContain("chat.postMessage");
    expect(calls[1].url).toContain("hooks.slack.com");
    expect(String(calls[1].body.text)).toContain("intended channel: #missing");
  });

  it("returns false and logs when nothing is configured", async () => {
    mockFetch(() => ({ ok: true }));
    const ok = await postSlack({ text: "nowhere" }, { channel: "x" });
    expect(ok).toBe(false);
    // No webhook and no bot token: no network call.
    expect(calls).toHaveLength(0);
  });
});
