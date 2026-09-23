import type { MessageDirection, MessageType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  decodeConversationMessageCursor,
  encodeConversationMessageCursor,
  messageRowToCursor,
} from "./conversationMessageCursor.js";

export type ConversationMessageSearchFilters = {
  q?: string;
  type?: MessageType;
  direction?: MessageDirection;
  from?: Date;
  to?: Date;
};

export function buildConversationMessageSearchWhere(
  conversationId: string,
  filters: ConversationMessageSearchFilters,
): Prisma.MessageWhereInput {
  const q = filters.q?.trim();
  const where: Prisma.MessageWhereInput = { conversationId };

  if (q) {
    where.body = { contains: q, mode: "insensitive" };
  }
  if (filters.type) {
    where.type = filters.type;
  }
  if (filters.direction) {
    where.direction = filters.direction;
  }
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
}

export function buildConversationMessageSnippet(body: string | null, query: string, maxLen = 140): string {
  const text = body?.trim() ?? "";
  if (!text) return "";
  const q = query.trim();
  if (!q) {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
  }

  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lowerText.indexOf(lowerQ);
  if (idx < 0) {
    return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1)}…`;
  }

  const radius = Math.floor((maxLen - q.length) / 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

type MessageRow = {
  id: string;
  createdAt: Date;
  body: string | null;
  direction: MessageDirection;
  type: MessageType;
  mediaUrl: string | null;
  mediaType: string | null;
  isPrivate: boolean;
  status: string;
  sentAt: Date;
  channel: string | null;
  actorUser: {
    id: string;
    name: string;
    displayName: string | null;
    showAgentNameInChat: boolean;
  } | null;
};

export async function searchConversationMessages(input: {
  conversationId: string;
  filters: ConversationMessageSearchFilters;
  limit: number;
  cursor?: string | null;
  include: Prisma.MessageInclude;
}): Promise<{
  results: Array<{ message: MessageRow; snippet: string; cursor: string }>;
  total: number;
  nextCursor: string | null;
}> {
  const where = buildConversationMessageSearchWhere(input.conversationId, input.filters);
  const q = input.filters.q?.trim() ?? "";

  let cursorFilter: Prisma.MessageWhereInput | undefined;
  if (input.cursor) {
    const decoded = decodeConversationMessageCursor(input.cursor);
    if (!decoded) {
      throw new Error("INVALID_CURSOR");
    }
    const anchor = await prisma.message.findFirst({
      where: { id: decoded.id, conversationId: input.conversationId },
      select: { id: true, createdAt: true },
    });
    if (!anchor || anchor.createdAt.toISOString() !== decoded.createdAt) {
      throw new Error("INVALID_CURSOR");
    }
    cursorFilter = { createdAt: { lt: anchor.createdAt } };
  }

  const fullWhere: Prisma.MessageWhereInput = cursorFilter ? { AND: [where, cursorFilter] } : where;

  const [batch, total] = await Promise.all([
    prisma.message.findMany({
      where: fullWhere,
      orderBy: { createdAt: "desc" },
      take: input.limit + 1,
      include: input.include,
    }),
    prisma.message.count({ where }),
  ]);

  const hasMore = batch.length > input.limit;
  const rows = (hasMore ? batch.slice(0, input.limit) : batch) as MessageRow[];
  const results = rows.map((message) => ({
    message,
    snippet: buildConversationMessageSnippet(message.body, q),
    cursor: encodeConversationMessageCursor(messageRowToCursor(message)),
  }));

  return {
    results,
    total,
    nextCursor: hasMore && rows.length > 0 ? results[results.length - 1]!.cursor : null,
  };
}

export async function loadAroundConversationMessages(
  conversationId: string,
  anchor: { id: string; createdAt: Date },
  limit: number,
  include: Prisma.MessageInclude,
): Promise<{
  messages: Awaited<ReturnType<typeof prisma.message.findMany>>;
  messagesHasMoreBefore: boolean;
  messagesHasMoreAfter: boolean;
  messagesOlderCursor: string | null;
  messagesNewerCursor: string | null;
  focusMessageId: string;
}> {
  const half = Math.max(1, Math.floor(limit / 2));

  const [olderBatch, newerBatch] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId, createdAt: { lte: anchor.createdAt } },
      orderBy: { createdAt: "desc" },
      take: half + 1,
      include,
    }),
    prisma.message.findMany({
      where: { conversationId, createdAt: { gt: anchor.createdAt } },
      orderBy: { createdAt: "asc" },
      take: half,
      include,
    }),
  ]);

  const messagesHasMoreBefore = olderBatch.length > half;
  const older = (messagesHasMoreBefore ? olderBatch.slice(0, half) : olderBatch).reverse();
  const messages = [...older, ...newerBatch];
  const messagesHasMoreAfter = newerBatch.length >= half;

  const first = messages[0];
  const last = messages[messages.length - 1];

  return {
    messages,
    messagesHasMoreBefore,
    messagesHasMoreAfter,
    messagesOlderCursor:
      messagesHasMoreBefore && first
        ? encodeConversationMessageCursor(messageRowToCursor(first))
        : null,
    messagesNewerCursor: last ? encodeConversationMessageCursor(messageRowToCursor(last)) : null,
    focusMessageId: anchor.id,
  };
}

export function parseConversationMessageSearchDate(raw: string | undefined): Date | "invalid" | undefined {
  if (!raw?.trim()) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}
