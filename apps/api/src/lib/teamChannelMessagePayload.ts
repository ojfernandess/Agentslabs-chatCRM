import { TeamChannelMessageType } from "@prisma/client";

export type TeamChannelReactionRow = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: { id: string; name: string }[];
};

export function inferTeamChannelMessageType(mimeType: string | null | undefined): TeamChannelMessageType {
  const m = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return TeamChannelMessageType.IMAGE;
  if (
    m === "application/pdf" ||
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return TeamChannelMessageType.DOCUMENT;
  }
  if (m) return TeamChannelMessageType.FILE;
  return TeamChannelMessageType.TEXT;
}

export function mapTeamChannelMessageReactions(
  rows: {
    emoji: string;
    userId: string;
    user: { id: string; name: string; displayName: string | null };
  }[],
  currentUserId: string,
): TeamChannelReactionRow[] {
  const byEmoji = new Map<string, TeamChannelReactionRow>();
  for (const row of rows) {
    const name = row.user.displayName?.trim() || row.user.name;
    let bucket = byEmoji.get(row.emoji);
    if (!bucket) {
      bucket = { emoji: row.emoji, count: 0, reactedByMe: false, users: [] };
      byEmoji.set(row.emoji, bucket);
    }
    bucket.count += 1;
    if (row.userId === currentUserId) bucket.reactedByMe = true;
    bucket.users.push({ id: row.user.id, name });
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
