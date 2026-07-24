import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db.js";
import type { AutomationContextState } from "../../automationConversationContextLib.js";
import { parseAgentEngineConfig } from "../config/parseAgentEngineConfig.js";
import {
  filterRelevantAiMemoryText,
  mergeMemoryCenterIntoState,
  parseMemoryCenterFromState,
  suggestAiMemoryFromTurn,
  type AiMemoryEntry,
  type MemoryCenterSearchHit,
  type MemoryCenterStateSlice,
  type MemoryCenterView,
} from "./memoryCenterTypes.js";
import { fetchMem0MemoriesForCenter } from "./mem0MemoryBridge.js";
import { isMem0Configured } from "./mem0Client.js";
import { listScopeMemories } from "./openNexoMemoryRepository.js";
import type { MemoryRecord } from "./memoryEngineTypes.js";
import { createMemoryProvider } from "./MemoryProvider.js";

function parseFlowSlots(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function recordToAiEntry(row: MemoryRecord | AiMemoryEntry): AiMemoryEntry {
  if ("source" in row && !("origin" in row)) return row as AiMemoryEntry;
  const m = row as MemoryRecord;
  return {
    id: m.id,
    text: m.text,
    source: m.origin === "manual" ? "manual" : m.origin === "system" ? "system" : "agent",
    createdAt: m.createdAt,
    category: m.category,
    confidence: m.confidence,
    status: m.status,
    score: m.score,
    origin: m.origin,
    scope: m.scope,
    lastUsedAt: m.lastUsedAt,
    useCount: m.useCount,
  };
}

function splitMemorySections(records: AiMemoryEntry[]) {
  return {
    memoryRecords: records,
    pinnedMemories: records.filter((r) => r.status === "pinned"),
    automaticMemories: records.filter((r) => r.source === "agent" && r.status !== "archived" && r.status !== "pinned"),
    manualMemories: records.filter((r) => r.source === "manual" && r.status !== "archived"),
    archivedMemories: records.filter((r) => r.status === "archived"),
  };
}

function readAutomationState(state: unknown): AutomationContextState & { memoryCenter?: unknown } {
  if (!state || typeof state !== "object") return {};
  return state as AutomationContextState & { memoryCenter?: unknown };
}

async function loadContactBundle(organizationId: string, contactId: string) {
  return prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    include: {
      tags: { include: { tag: true } },
      conversations: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          automationContext: { include: { bot: { select: { id: true, name: true } } } },
        },
      },
    },
  });
}

async function loadInteractions(organizationId: string, conversationId: string | null, contactId: string) {
  if (conversationId) {
    return prisma.automationInteraction.findMany({
      where: { organizationId, conversationId },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { bot: { select: { name: true } } },
    });
  }
  const convIds = (
    await prisma.conversation.findMany({
      where: { organizationId, contactId, deletedAt: null },
      select: { id: true },
      take: 10,
    })
  ).map((c) => c.id);
  if (convIds.length === 0) return [];
  return prisma.automationInteraction.findMany({
    where: { organizationId, conversationId: { in: convIds } },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { bot: { select: { name: true } } },
  });
}

export async function buildMemoryCenterView(input: {
  organizationId: string;
  contactId: string;
  conversationId?: string | null;
}): Promise<MemoryCenterView | null> {
  const contact = await loadContactBundle(input.organizationId, input.contactId);
  if (!contact) return null;

  let conversation =
    (input.conversationId
      ? contact.conversations.find((c) => c.id === input.conversationId)
      : null) ?? contact.conversations.find((c) => c.automationContext) ?? contact.conversations[0] ?? null;

  const ctx = conversation?.automationContext ?? null;
  const state = readAutomationState(ctx?.state);
  const mc = parseMemoryCenterFromState(state);

  const interactions = await loadInteractions(
    input.organizationId,
    conversation?.id ?? null,
    contact.id,
  );

  const lastInteractionAt =
    mc.lastInteractionAt ??
    interactions[0]?.createdAt.toISOString() ??
    conversation?.updatedAt.toISOString() ??
    contact.updatedAt.toISOString();

  let memoryProvider: "openconduit" | "mem0" = "openconduit";
  if (ctx?.botId) {
    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId: ctx.botId, organizationId: input.organizationId },
      select: { behaviorConfig: true },
    });
    memoryProvider = parseAgentEngineConfig(profile?.behaviorConfig).memory;
  }

  let aiMemories = (mc.aiMemories ?? []).map((m) => ({ ...m }));
  const resolvedConversationId = conversation?.id ?? input.conversationId ?? null;
  if (resolvedConversationId) {
    const engineRecords = await listScopeMemories({
      organizationId: input.organizationId,
      scope: "contact",
      conversationId: resolvedConversationId,
      botId: ctx?.botId,
      contactId: contact.id,
    });
    if (engineRecords.length > 0) {
      aiMemories = engineRecords.map(recordToAiEntry);
    }
  }
  if (memoryProvider === "mem0" && isMem0Configured() && resolvedConversationId) {
    const remote = await fetchMem0MemoriesForCenter({
      organizationId: input.organizationId,
      conversationId: resolvedConversationId,
      botId: ctx?.botId,
      contactId: contact.id,
    });
    if (remote.length > 0) {
      const byId = new Map(aiMemories.map((m) => [m.id, m]));
      for (const row of remote) byId.set(row.id, row);
      aiMemories = [...byId.values()];
    }
  }

  const sections = splitMemorySections(aiMemories);

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
    },
    conversationId: conversation?.id ?? null,
    botId: ctx?.botId ?? null,
    botName: ctx?.bot?.name ?? null,
    tags: contact.tags.map((ct) => ({
      id: ct.tag.id,
      name: ct.tag.name,
      color: ct.tag.color,
    })),
    preferences: mc.preferences ?? {},
    aiMemories,
    ...sections,
    score: mc.score ?? null,
    lastInteractionAt,
    flowSlots: parseFlowSlots(state.flowSlots),
    flowStep: typeof state.flowStep === "string" ? state.flowStep : null,
    history: interactions.map((row) => ({
      userMessage: row.userMessage,
      assistantMessage: row.assistantMessage,
      at: row.createdAt.toISOString(),
      botName: row.bot.name,
    })),
    memoryProvider,
    contextUpdatedAt: ctx?.updatedAt.toISOString() ?? null,
  };
}

export async function searchMemoryCenterContacts(
  organizationId: string,
  query: string,
): Promise<MemoryCenterSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const contacts = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    include: {
      tags: { include: { tag: true } },
      conversations: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: { automationContext: true },
      },
    },
  });

  return contacts.map((c) => {
    const conv = c.conversations[0] ?? null;
    const mc = parseMemoryCenterFromState(conv?.automationContext?.state);
    return {
      contactId: c.id,
      contactName: c.name,
      contactPhone: c.phone,
      conversationId: conv?.id ?? null,
      lastInteractionAt: mc.lastInteractionAt ?? conv?.updatedAt.toISOString() ?? c.updatedAt.toISOString(),
      score: mc.score ?? null,
      tagNames: c.tags.map((t) => t.tag.name),
    };
  });
}

export async function updateMemoryCenterForConversation(input: {
  organizationId: string;
  conversationId: string;
  patch: {
    preferences?: Record<string, string>;
    aiMemories?: Array<{ text: string; source?: AiMemoryEntry["source"] }>;
    score?: number | null;
  };
}): Promise<MemoryCenterView | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, contactId: true },
  });
  if (!conv) return null;

  const ctx = await prisma.automationConversationContext.findUnique({
    where: { conversationId: conv.id },
  });
  if (!ctx) return buildMemoryCenterView({ organizationId: input.organizationId, contactId: conv.contactId, conversationId: conv.id });

  const prevState =
    ctx.state && typeof ctx.state === "object" ? (ctx.state as Record<string, unknown>) : {};
  const prevMc = parseMemoryCenterFromState(prevState);

  let aiMemories = prevMc.aiMemories ?? [];
  if (input.patch.aiMemories) {
    aiMemories = input.patch.aiMemories
      .map((row, idx) => {
        const text = row.text.trim();
        if (!filterRelevantAiMemoryText(text)) return null;
        return {
          id: `manual_${Date.now()}_${idx}`,
          text,
          source: row.source ?? ("manual" as const),
          createdAt: new Date().toISOString(),
        };
      })
      .filter((x): x is AiMemoryEntry => x != null);
  }

  const slice: MemoryCenterStateSlice = {
    preferences: input.patch.preferences ?? prevMc.preferences,
    aiMemories,
    score: input.patch.score !== undefined ? input.patch.score : prevMc.score,
    lastInteractionAt: new Date().toISOString(),
  };

  const nextState = mergeMemoryCenterIntoState(prevState, slice);
  await prisma.automationConversationContext.update({
    where: { conversationId: conv.id },
    data: { state: nextState as Prisma.InputJsonValue },
  });

  return buildMemoryCenterView({
    organizationId: input.organizationId,
    contactId: conv.contactId,
    conversationId: conv.id,
  });
}

export async function patchContactMemoryRecord(input: {
  organizationId: string;
  conversationId: string;
  memoryId: string;
  patch: {
    text?: string;
    category?: MemoryRecord["category"];
    status?: MemoryRecord["status"];
    score?: number;
  };
  providerKind?: "openconduit" | "mem0";
}): Promise<MemoryCenterView | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, contactId: true },
  });
  if (!conv) return null;
  const ctx = await prisma.automationConversationContext.findUnique({
    where: { conversationId: conv.id },
    select: { botId: true },
  });
  const provider = createMemoryProvider(input.providerKind ?? "openconduit");
  await provider.update({
    organizationId: input.organizationId,
    scope: "contact",
    conversationId: conv.id,
    botId: ctx?.botId,
    contactId: conv.contactId,
    id: input.memoryId,
    patch: input.patch,
  });
  return buildMemoryCenterView({
    organizationId: input.organizationId,
    contactId: conv.contactId,
    conversationId: conv.id,
  });
}

export async function deleteContactMemoryRecord(input: {
  organizationId: string;
  conversationId: string;
  memoryId: string;
  providerKind?: "openconduit" | "mem0";
}): Promise<MemoryCenterView | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, contactId: true },
  });
  if (!conv) return null;
  const ctx = await prisma.automationConversationContext.findUnique({
    where: { conversationId: conv.id },
    select: { botId: true },
  });
  const provider = createMemoryProvider(input.providerKind ?? "openconduit");
  await provider.delete({
    organizationId: input.organizationId,
    scope: "contact",
    conversationId: conv.id,
    botId: ctx?.botId,
    contactId: conv.contactId,
    id: input.memoryId,
  });
  return buildMemoryCenterView({
    organizationId: input.organizationId,
    contactId: conv.contactId,
    conversationId: conv.id,
  });
}

export async function exportContactMemories(input: {
  organizationId: string;
  conversationId: string;
}): Promise<{ version: number; exportedAt: string; memories: AiMemoryEntry[] } | null> {
  const view = await buildMemoryCenterView({
    organizationId: input.organizationId,
    contactId: (
      await prisma.conversation.findFirst({
        where: { id: input.conversationId, organizationId: input.organizationId },
        select: { contactId: true },
      })
    )?.contactId ?? "",
    conversationId: input.conversationId,
  });
  if (!view) return null;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    memories: view.memoryRecords,
  };
}

export async function importContactMemories(input: {
  organizationId: string;
  conversationId: string;
  memories: Array<{
    text: string;
    category?: MemoryRecord["category"];
    status?: MemoryRecord["status"];
    source?: AiMemoryEntry["source"] | "import";
  }>;
}): Promise<MemoryCenterView | null> {
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, organizationId: input.organizationId },
    select: { id: true, contactId: true },
  });
  if (!conv) return null;

  const ctx = await prisma.automationConversationContext.findUnique({
    where: { conversationId: conv.id },
    select: { botId: true },
  });

  const provider = createMemoryProvider("openconduit");
  for (const row of input.memories) {
    const text = row.text.trim();
    if (!text || text.length < 20) continue;
    if (!filterRelevantAiMemoryText(text)) continue;
    await provider.save({
      organizationId: input.organizationId,
      scope: "contact",
      conversationId: conv.id,
      botId: ctx?.botId,
      contactId: conv.contactId,
      record: {
        text,
        category: row.category ?? "preferences",
        origin: row.source === "manual" ? "manual" : row.source === "system" ? "system" : "import",
        confidence: 0.85,
        status: row.status ?? "active",
        scope: "contact",
        score: 0.7,
      },
    });
  }

  return buildMemoryCenterView({
    organizationId: input.organizationId,
    contactId: conv.contactId,
    conversationId: conv.id,
  });
}
