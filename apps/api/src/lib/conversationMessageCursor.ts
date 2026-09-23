export type ConversationMessageCursor = {
  id: string;
  createdAt: string;
};

export function encodeConversationMessageCursor(cursor: ConversationMessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeConversationMessageCursor(raw: string): ConversationMessageCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const createdAt = typeof o.createdAt === "string" ? o.createdAt.trim() : "";
    if (!id || !createdAt || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { id, createdAt };
  } catch {
    return null;
  }
}

export function messageRowToCursor(message: { id: string; createdAt: Date }): ConversationMessageCursor {
  return { id: message.id, createdAt: message.createdAt.toISOString() };
}

export function buildOlderMessageCursor(
  messages: { id: string; createdAt: Date }[],
  messagesHasMore: boolean,
): string | null {
  if (!messagesHasMore || messages.length === 0) return null;
  return encodeConversationMessageCursor(messageRowToCursor(messages[0]!));
}

export function buildNewerMessageCursor(messages: { id: string; createdAt: Date }[]): string | null {
  const last = messages[messages.length - 1];
  return last ? encodeConversationMessageCursor(messageRowToCursor(last)) : null;
}
