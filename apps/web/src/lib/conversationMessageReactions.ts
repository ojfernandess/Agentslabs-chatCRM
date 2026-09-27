export type ConversationMessageReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  senderType: "CONTACT" | "AGENT";
  users: { id: string; name: string }[];
};

type RawReactionRow = {
  emoji: string;
  senderType: "CONTACT" | "AGENT";
  actorKey?: string;
  actorUserId?: string | null;
  actorUser?: { id: string; name: string; displayName: string | null } | null;
  count?: number;
  reactedByMe?: boolean;
  users?: { id: string; name: string }[];
};

export function normalizeConversationMessageReactions(
  raw: unknown,
  currentUserId?: string,
): ConversationMessageReaction[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const rows = raw as RawReactionRow[];
  if (rows[0]?.count != null && rows[0]?.users) {
    return rows as ConversationMessageReaction[];
  }

  const byEmoji = new Map<string, ConversationMessageReaction>();
  for (const row of rows) {
    let bucket = byEmoji.get(row.emoji);
    if (!bucket) {
      bucket = {
        emoji: row.emoji,
        count: 0,
        reactedByMe: false,
        senderType: row.senderType,
        users: [],
      };
      byEmoji.set(row.emoji, bucket);
    }
    bucket.count += 1;
    const name =
      row.actorUser?.displayName?.trim() ||
      row.actorUser?.name ||
      (row.senderType === "CONTACT" ? "Cliente" : "Agente");
    if (row.senderType === "AGENT" && row.actorUserId === currentUserId) {
      bucket.reactedByMe = true;
    }
    if (row.actorUser) {
      bucket.users.push({ id: row.actorUser.id, name });
    } else if (row.senderType === "CONTACT") {
      bucket.users.push({ id: row.actorKey ?? row.emoji, name });
    }
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
