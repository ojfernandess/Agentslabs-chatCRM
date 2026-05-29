import { prisma } from "../db.js";
import type { Prisma } from "@prisma/client";

export const CONVERSATION_MEDIA_RETENTION_KEY = "conversation_media_retention";

export type ConversationMediaRetentionMonths = 1 | 2 | 3 | 4 | 5;

export type ConversationMediaRetentionValue = {
  enabled: boolean;
  retentionMonths: ConversationMediaRetentionMonths;
  lastRunAt?: string | null;
  lastDeletedFiles?: number;
  lastClearedReferences?: number;
};

const VALID_MONTHS = new Set<number>([1, 2, 3, 4, 5]);

export function parseConversationMediaRetentionValue(raw: unknown): ConversationMediaRetentionValue {
  if (!raw || typeof raw !== "object" || raw === null) {
    return { enabled: false, retentionMonths: 3 };
  }
  const o = raw as Record<string, unknown>;
  const monthsRaw = Number(o.retentionMonths ?? 3);
  const retentionMonths = (VALID_MONTHS.has(monthsRaw) ? monthsRaw : 3) as ConversationMediaRetentionMonths;
  return {
    enabled: o.enabled === true,
    retentionMonths,
    lastRunAt: typeof o.lastRunAt === "string" ? o.lastRunAt : null,
    lastDeletedFiles: typeof o.lastDeletedFiles === "number" ? o.lastDeletedFiles : 0,
    lastClearedReferences: typeof o.lastClearedReferences === "number" ? o.lastClearedReferences : 0,
  };
}

export async function getConversationMediaRetentionFromDb(): Promise<ConversationMediaRetentionValue> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: CONVERSATION_MEDIA_RETENTION_KEY },
  });
  return parseConversationMediaRetentionValue(row?.value);
}

export async function saveConversationMediaRetentionValue(
  value: ConversationMediaRetentionValue,
): Promise<ConversationMediaRetentionValue> {
  await prisma.platformSetting.upsert({
    where: { key: CONVERSATION_MEDIA_RETENTION_KEY },
    create: { key: CONVERSATION_MEDIA_RETENTION_KEY, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
  return value;
}
