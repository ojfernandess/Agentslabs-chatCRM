import type { TimelinePayload } from "@/lib/contactTimeline";

export type ConversationChatFeedItem =
  | { kind: "message"; messageIndex: number; at: number }
  | { kind: "handoff"; eventId: string; at: number; payload: TimelinePayload; actorName: string | null };

export function buildConversationChatFeed(input: {
  messages: Array<{ id: string; sentAt: string }>;
  timeline?: Array<{
    id: string;
    occurredAt: string;
    eventType: string;
    payload: unknown;
    actorUser?: { name?: string | null } | null;
  }>;
}): ConversationChatFeedItem[] {
  const items: ConversationChatFeedItem[] = input.messages.map((message, messageIndex) => ({
    kind: "message",
    messageIndex,
    at: new Date(message.sentAt).getTime(),
  }));

  for (const event of input.timeline ?? []) {
    if (event.eventType !== "conversation.handoff") continue;
    const payload = (event.payload ?? {}) as TimelinePayload;
    const actorFromUser = event.actorUser?.name?.trim() || null;
    const botActor =
      payload.handoffSource === "call_human" && typeof payload.botName === "string"
        ? payload.botName.trim() || null
        : null;
    items.push({
      kind: "handoff",
      eventId: event.id,
      at: new Date(event.occurredAt).getTime(),
      payload,
      actorName: actorFromUser ?? botActor,
    });
  }

  items.sort((a, b) => a.at - b.at);
  return items;
}

export function shouldShowChatDaySeparator(
  feed: ConversationChatFeedItem[],
  index: number,
  dayKey: (at: number) => string,
): boolean {
  if (index === 0) return true;
  return dayKey(feed[index].at) !== dayKey(feed[index - 1].at);
}
