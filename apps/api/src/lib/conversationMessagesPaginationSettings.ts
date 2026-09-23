import { prisma } from "../db.js";

/** Chave em `platform_settings` — activável no super admin. */
export const CONVERSATION_MESSAGES_PAGINATION_KEY = "conversation_messages_pagination";

export type ConversationMessagesPaginationValue = {
  enabled: boolean;
  pageSize: number;
};

export const DEFAULT_CONVERSATION_MESSAGES_PAGE_SIZE = 50;
const MIN_CONVERSATION_MESSAGES_PAGE_SIZE = 10;
const MAX_CONVERSATION_MESSAGES_PAGE_SIZE = 200;

export function parseConversationMessagesPaginationValue(
  raw: unknown,
): ConversationMessagesPaginationValue {
  if (!raw || typeof raw !== "object" || raw === null) {
    return { enabled: false, pageSize: DEFAULT_CONVERSATION_MESSAGES_PAGE_SIZE };
  }
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true;
  let pageSize = Number(o.pageSize ?? DEFAULT_CONVERSATION_MESSAGES_PAGE_SIZE);
  if (!Number.isFinite(pageSize)) pageSize = DEFAULT_CONVERSATION_MESSAGES_PAGE_SIZE;
  pageSize = Math.min(
    MAX_CONVERSATION_MESSAGES_PAGE_SIZE,
    Math.max(MIN_CONVERSATION_MESSAGES_PAGE_SIZE, Math.round(pageSize)),
  );
  return { enabled, pageSize };
}

export async function getConversationMessagesPaginationFromDb(): Promise<ConversationMessagesPaginationValue> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: CONVERSATION_MESSAGES_PAGINATION_KEY },
  });
  return parseConversationMessagesPaginationValue(row?.value);
}
