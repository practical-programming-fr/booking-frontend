import type { SlackMessageRef, SlackPostOptions } from "./slack";
import type { IncidentEvent, OpsIncident } from "./types";

const SLACK_THREAD_EVENT_KIND = "slack_thread_started";

export function createSlackThreadEvent(
  ref: SlackMessageRef,
): IncidentEvent {
  return {
    at: new Date().toISOString(),
    kind: SLACK_THREAD_EVENT_KIND,
    message: "Slack incident thread started.",
    data: {
      slackChannelId: ref.channel,
      slackThreadTs: ref.ts,
    },
  };
}

export function slackThreadOfIncident(
  incident: Pick<OpsIncident, "events">,
): SlackMessageRef | null {
  for (let index = incident.events.length - 1; index >= 0; index -= 1) {
    const event = incident.events[index];
    if (event?.kind !== SLACK_THREAD_EVENT_KIND) continue;
    const channel = event.data?.slackChannelId;
    const ts = event.data?.slackThreadTs;
    if (typeof channel === "string" && typeof ts === "string") {
      return { channel, ts };
    }
  }
  return null;
}

export function slackReplyOptions(
  incident: Pick<OpsIncident, "events">,
  fallbackChannel?: string,
): SlackPostOptions {
  const thread = slackThreadOfIncident(incident);
  return thread
    ? { channel: thread.channel, threadTs: thread.ts }
    : { channel: fallbackChannel };
}
