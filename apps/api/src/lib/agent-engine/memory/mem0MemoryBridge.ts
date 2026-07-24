import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../../../db.js";
import type { AiMemoryEntry } from "./memoryCenterTypes.js";
import { filterRelevantAiMemoryText, suggestAiMemoryFromTurn } from "./memoryCenterTypes.js";
import {
  buildMem0AgentId,
  buildMem0UserId,
  isMem0Configured,
  mem0AddConversationTurn,
  mem0AddDirectMemory,
  mem0ListMemories,
  mem0SearchMemories,
  type Mem0MemoryRecord,
} from "./mem0Client.js";

export type Mem0EntityContext = {
  userId: string;
  agentId?: string;
  contactId: string | null;
};

export async function resolveMem0EntityContext(input: {
  organizationId: string;
  conversationId: string;
  botId?: string | null;
  contactId?: string | null;
}): Promise<Mem0EntityContext | null> {
  let contactId = input.contactId?.trim() || null;
  if (!contactId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: input.conversationId, organizationId: input.organizationId },
      select: { contactId: true },
    });
    contactId = conv?.contactId ?? null;
  }
  if (!contactId) return null;

  return {
    contactId,
    userId: buildMem0UserId(input.organizationId, contactId),
    agentId: input.botId ? buildMem0AgentId(input.organizationId, input.botId) : undefined,
  };
}

export function mem0RecordsToAiMemories(records: Mem0MemoryRecord[]): AiMemoryEntry[] {
  return records.map((row) => ({
    id: row.id,
    text: row.memory,
    source: "agent" as const,
    createdAt: row.createdAt ?? new Date().toISOString(),
  }));
}

export function formatMem0PromptAppendix(records: Mem0MemoryRecord[]): string {
  if (records.length === 0) return "";
  const lines = records.map((r, idx) => {
    const score =
      typeof r.score === "number" ? ` (relevância ${(r.score * 100).toFixed(0)}%)` : "";
    return `${idx + 1}. ${r.memory}${score}`;
  });
  return (
    "\n\n[OpenConduit — memória Mem0 do contacto]\n" +
    "Factos persistentes sobre este contacto (ignore saudações e dados temporários):\n" +
    lines.join("\n")
  );
}

export async function loadMem0MemoriesForPrompt(input: {
  organizationId: string;
  conversationId: string;
  botId: string;
  contactId?: string | null;
  userMessage: string;
}): Promise<{ records: Mem0MemoryRecord[]; appendix: string }> {
  if (!isMem0Configured()) return { records: [], appendix: "" };

  const ctx = await resolveMem0EntityContext(input);
  if (!ctx) return { records: [], appendix: "" };

  try {
    const searched = await mem0SearchMemories({
      userId: ctx.userId,
      agentId: ctx.agentId,
      query: input.userMessage.trim() || "preferências e contexto do contacto",
      topK: 6,
    });
    const records =
      searched.length > 0
        ? searched
        : await mem0ListMemories({ userId: ctx.userId, agentId: ctx.agentId, topK: 8 });
    const filtered = records.filter((r) => filterRelevantAiMemoryText(r.memory));
    return { records: filtered, appendix: formatMem0PromptAppendix(filtered) };
  } catch {
    return { records: [], appendix: "" };
  }
}

export async function syncTurnToMem0(input: {
  organizationId: string;
  conversationId: string;
  botId: string;
  contactId?: string | null;
  userMessage: string;
  assistantMessage: string;
  log?: FastifyBaseLogger;
}): Promise<{ synced: boolean; eventIds: string[] }> {
  if (!isMem0Configured()) return { synced: false, eventIds: [] };

  const user = input.userMessage.trim();
  const assistant = input.assistantMessage.trim();
  if (!user && !assistant) return { synced: false, eventIds: [] };

  const ctx = await resolveMem0EntityContext(input);
  if (!ctx) return { synced: false, eventIds: [] };

  const eventIds: string[] = [];
  try {
    const turn = await mem0AddConversationTurn({
      userId: ctx.userId,
      agentId: ctx.agentId,
      userMessage: user,
      assistantMessage: assistant,
      metadata: {
        conversationId: input.conversationId,
        botId: input.botId,
        contactId: ctx.contactId,
      },
    });
    if (turn.eventId) eventIds.push(turn.eventId);

    const direct = suggestAiMemoryFromTurn(user, assistant);
    if (direct && filterRelevantAiMemoryText(direct)) {
      const directRes = await mem0AddDirectMemory({
        userId: ctx.userId,
        agentId: ctx.agentId,
        content: direct,
        metadata: {
          conversationId: input.conversationId,
          botId: input.botId,
          contactId: ctx.contactId,
          kind: "explicit_fact",
        },
      });
      if (directRes.eventId) eventIds.push(directRes.eventId);
    }

    return { synced: eventIds.length > 0, eventIds };
  } catch (err) {
    input.log?.warn({ err, conversationId: input.conversationId }, "mem0 sync failed");
    return { synced: false, eventIds: [] };
  }
}

export async function fetchMem0MemoriesForCenter(input: {
  organizationId: string;
  conversationId: string;
  botId?: string | null;
  contactId: string;
}): Promise<AiMemoryEntry[]> {
  if (!isMem0Configured()) return [];
  const ctx = await resolveMem0EntityContext(input);
  if (!ctx) return [];
  try {
    const records = await mem0ListMemories({
      userId: ctx.userId,
      agentId: ctx.agentId,
      topK: 25,
    });
    return mem0RecordsToAiMemories(records.filter((r) => filterRelevantAiMemoryText(r.memory)));
  } catch {
    return [];
  }
}
