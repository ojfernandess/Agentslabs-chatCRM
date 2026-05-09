export interface TimelinePayload {
  body?: unknown;
  messageId?: unknown;
  type?: unknown;
  mediaUrl?: unknown;
  isPrivate?: unknown;
  name?: unknown;
  fields?: unknown;
  inboxName?: unknown;
  channelLabel?: unknown;
  previousTeamName?: unknown;
  newTeamName?: unknown;
  previousAssigneeName?: unknown;
  newAssigneeName?: unknown;
  [key: string]: unknown;
}

const EVENT_I18N: Record<string, string> = {
  "message.inbound": "contactDetail.timelineMessageInbound",
  "message.outbound": "contactDetail.timelineMessageOutbound",
  "conversation.handoff": "contactDetail.timelineHandoff",
  "conversation.started": "conversationDetail.timelineConversationStarted",
  "deal.created": "contactDetail.timelineDealCreated",
  "deal.linked": "contactDetail.timelineDealLinked",
  "deal.updated": "contactDetail.timelineDealUpdated",
};

const CHANNEL_I18N: Record<string, string> = {
  whatsapp: "contactDetail.timelineChannelWhatsapp",
  conversation: "contactDetail.timelineChannelConversation",
};

function humanizeUnknownEventType(eventType: string): string {
  return eventType
    .split(/[._]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" · ");
}

export function timelineEventTitle(eventType: string, t: (path: string) => string): string {
  const path = EVENT_I18N[eventType];
  return path ? t(path) : humanizeUnknownEventType(eventType);
}

export function timelineChannelLabel(channel: string | null, t: (path: string) => string): string | null {
  if (!channel) return null;
  const path = CHANNEL_I18N[channel.toLowerCase()];
  return path ? t(path) : channel;
}

function handoffSummary(payload: TimelinePayload, t: (path: string) => string): string | null {
  const dash = t("contactDetail.timelineDash");
  const prevTeam =
    typeof payload.previousTeamName === "string" && payload.previousTeamName.trim()
      ? payload.previousTeamName.trim()
      : null;
  const newTeam =
    typeof payload.newTeamName === "string" && payload.newTeamName.trim()
      ? payload.newTeamName.trim()
      : null;
  const prevA =
    typeof payload.previousAssigneeName === "string" && payload.previousAssigneeName.trim()
      ? payload.previousAssigneeName.trim()
      : null;
  const newA =
    typeof payload.newAssigneeName === "string" && payload.newAssigneeName.trim()
      ? payload.newAssigneeName.trim()
      : null;

  const parts: string[] = [];
  if (prevTeam != null || newTeam != null) {
    parts.push(`${t("contactDetail.timelineTeam")}: ${prevTeam ?? dash} → ${newTeam ?? dash}`);
  }
  if (prevA != null || newA != null) {
    parts.push(`${t("contactDetail.timelineAssignee")}: ${prevA ?? dash} → ${newA ?? dash}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function messageSummary(payload: TimelinePayload, t: (path: string) => string): string | null {
  const bits: string[] = [];
  if (payload.isPrivate === true) {
    bits.push(t("contactDetail.timelinePrivateNote"));
  }
  const body = typeof payload.body === "string" && payload.body.trim() ? payload.body.trim() : null;
  if (body) {
    bits.push(body);
    return bits.join(" — ");
  }
  const typ = typeof payload.type === "string" ? payload.type : "";
  if (typ && typ !== "TEXT") {
    bits.push(`${t("contactDetail.timelineAttachment")} (${typ})`);
  }
  return bits.length ? bits.join(" — ") : null;
}

export function timelineEventSummary(
  eventType: string,
  payload: TimelinePayload,
  t: (path: string) => string,
): string | null {
  switch (eventType) {
    case "conversation.started": {
      const inbox =
        typeof payload.inboxName === "string" && payload.inboxName.trim()
          ? payload.inboxName.trim()
          : null;
      const ch =
        typeof payload.channelLabel === "string" && payload.channelLabel.trim()
          ? payload.channelLabel.trim()
          : null;
      const bits = [inbox, ch].filter(Boolean);
      return bits.length ? bits.join(" · ") : null;
    }
    case "conversation.handoff":
      return handoffSummary(payload, t);
    case "deal.created":
    case "deal.linked": {
      const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null;
      return name;
    }
    case "deal.updated": {
      const fields = Array.isArray(payload.fields)
        ? payload.fields.filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];
      return fields.length ? `${t("contactDetail.timelineDealFields")}: ${fields.join(", ")}` : null;
    }
    case "message.inbound":
    case "message.outbound":
      return messageSummary(payload, t);
    default: {
      if (typeof payload.body === "string" && payload.body.trim()) {
        return payload.body.trim();
      }
      return null;
    }
  }
}
