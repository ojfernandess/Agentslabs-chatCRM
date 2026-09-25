export const OPTIMISTIC_OUTBOUND_MESSAGE_PREFIX = "optimistic:outbound:";

export type OptimisticOutboundMessageInput = {
  body: string;
  type: "TEXT" | "IMAGE" | "DOCUMENT" | "AUDIO";
  isPrivate?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  actorUser?: {
    id: string;
    name: string;
    displayName: string | null;
    showAgentNameInChat?: boolean;
  } | null;
};

export type OptimisticOutboundMessage = {
  id: string;
  direction: "OUTBOUND";
  type: OptimisticOutboundMessageInput["type"];
  body: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isPrivate?: boolean;
  status: "SENT";
  sentAt: string;
  createdAt: string;
  actorUser?: OptimisticOutboundMessageInput["actorUser"];
};

export function isOptimisticOutboundMessageId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_OUTBOUND_MESSAGE_PREFIX);
}

export function createOptimisticOutboundMessage(input: OptimisticOutboundMessageInput): OptimisticOutboundMessage {
  const now = new Date().toISOString();
  return {
    id: `${OPTIMISTIC_OUTBOUND_MESSAGE_PREFIX}${crypto.randomUUID()}`,
    direction: "OUTBOUND",
    type: input.type,
    body: input.body,
    mediaUrl: input.mediaUrl ?? null,
    mediaType: input.mediaType ?? null,
    isPrivate: input.isPrivate ?? false,
    status: "SENT",
    sentAt: now,
    createdAt: now,
    actorUser: input.actorUser ?? null,
  };
}

export function stripOptimisticOutboundMessages<T extends { id: string }>(messages: T[]): T[] {
  return messages.filter((message) => !isOptimisticOutboundMessageId(message.id));
}
