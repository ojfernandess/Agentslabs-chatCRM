import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AutomationAgentProfile,
  ConversationInteractionBudget,
  Message,
  Organization,
  PlatformSetting,
  Prisma,
  Settings,
} from "@prisma/client";
import { prisma } from "../db.js";
import { buildNativeAgentMessageWhere } from "./agentConversationHistory.js";

export type CachedAutomationConversationContextRow = {
  id?: string;
  organizationId: string;
  conversationId: string;
  botId: string | null;
  state: unknown;
  lastClearedAt: Date | null;
  updatedAt?: Date | null;
};

export type CachedInteractionBudgetRow = Pick<
  ConversationInteractionBudget,
  "interactionCount" | "status"
>;

export type CachedRankedKnowledgeSearchResult = {
  ranked: unknown[];
  mode: "lexical" | "semantic" | "hybrid";
};

const NATIVE_HTTP_CUSTOM_TOOL_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  description: true,
  toolType: true,
  config: true,
  parametersSchema: true,
} satisfies Prisma.AutomationCustomToolSelect;

export type CachedNativeHttpCustomToolRow = Prisma.AutomationCustomToolGetPayload<{
  select: typeof NATIVE_HTTP_CUSTOM_TOOL_SELECT;
}>;

type AgentTurnCache = {
  profilesByBotId: Map<string, Promise<AutomationAgentProfile | null>>;
  featureFlags: Map<string, Promise<boolean>>;
  conversationContexts: Map<string, Promise<CachedAutomationConversationContextRow | null>>;
  customToolsByKey: Map<string, Promise<CachedNativeHttpCustomToolRow[]>>;
  interactionBudgetByConversation: Map<string, Promise<CachedInteractionBudgetRow | null>>;
  platformSettingsByKey: Map<string, Promise<PlatformSetting | null>>;
  organizationsById: Map<string, Promise<Organization | null>>;
  settingsByOrg: Map<string, Promise<Settings | null>>;
  nativeAgentMessages: Map<string, Promise<Array<Pick<Message, "direction" | "body">>>>;
  kbSearchByKey: Map<string, Promise<CachedRankedKnowledgeSearchResult>>;
  kbChunkCountByOrg: Map<string, Promise<number>>;
  kbArticleBotCountByBot: Map<string, Promise<number>>;
};

const als = new AsyncLocalStorage<AgentTurnCache>();

function createAgentTurnCache(): AgentTurnCache {
  return {
    profilesByBotId: new Map(),
    featureFlags: new Map(),
    conversationContexts: new Map(),
    customToolsByKey: new Map(),
    interactionBudgetByConversation: new Map(),
    platformSettingsByKey: new Map(),
    organizationsById: new Map(),
    settingsByOrg: new Map(),
    nativeAgentMessages: new Map(),
    kbSearchByKey: new Map(),
    kbChunkCountByOrg: new Map(),
    kbArticleBotCountByBot: new Map(),
  };
}

function getStore(): AgentTurnCache | undefined {
  return als.getStore();
}

export async function runWithAgentTurnLookupCache<T>(botId: string, fn: () => Promise<T>): Promise<T> {
  const parent = als.getStore();
  if (parent) {
    return await fn();
  }
  return await als.run(createAgentTurnCache(), fn);
}

/** Uma resolução por org+flag dentro do turno do agente (dispatch nativo / fila BullMQ). */
export function getCachedOrganizationFeatureEnabled(
  organizationId: string,
  key: string,
  resolve: () => Promise<boolean>,
): Promise<boolean> {
  const store = als.getStore();
  const cacheKey = `${organizationId}:${key}`;
  if (!store) {
    return resolve();
  }
  if (!store.featureFlags.has(cacheKey)) {
    store.featureFlags.set(cacheKey, resolve());
  }
  return store.featureFlags.get(cacheKey)!;
}

export function primeCachedAutomationConversationContext(
  conversationId: string,
  row: CachedAutomationConversationContextRow | null,
): void {
  const store = als.getStore();
  if (!store) return;
  store.conversationContexts.set(conversationId, Promise.resolve(row));
}

export function invalidateCachedAutomationConversationContext(conversationId: string): void {
  const store = als.getStore();
  if (!store) return;
  store.conversationContexts.delete(conversationId);
}

/**
 * Contexto de automação por `conversationId` — uma leitura por turno quando em escopo ALS.
 * Fora do turno, consulta o Prisma directamente.
 */
export async function getCachedAutomationConversationContextRow(
  conversationId: string,
): Promise<CachedAutomationConversationContextRow | null> {
  const store = als.getStore();
  if (store?.conversationContexts.has(conversationId)) {
    return await store.conversationContexts.get(conversationId)!;
  }

  const promise = prisma.automationConversationContext
    .findUnique({
      where: { conversationId },
      select: {
        id: true,
        organizationId: true,
        conversationId: true,
        botId: true,
        state: true,
        lastClearedAt: true,
        updatedAt: true,
      },
    })
    .then((row) => row ?? null);

  if (store) {
    store.conversationContexts.set(conversationId, promise);
  }

  return await promise;
}

/**
 * Perfil do agente por `botId` — uma leitura por turno (dispatch nativo / fila BullMQ).
 * Fora do escopo do turno, consulta o Prisma directamente.
 */
export async function getCachedAutomationAgentProfile(
  botId: string,
  organizationId?: string,
): Promise<AutomationAgentProfile | null> {
  const store = als.getStore();
  if (store?.profilesByBotId.has(botId)) {
    const cached = await store.profilesByBotId.get(botId)!;
    if (!cached) return null;
    if (organizationId && cached.organizationId !== organizationId) return null;
    return cached;
  }

  const promise = prisma.automationAgentProfile.findUnique({ where: { botId } });
  if (store) {
    store.profilesByBotId.set(botId, promise);
  }

  const profile = await promise;
  if (!profile) return null;
  if (organizationId && profile.organizationId !== organizationId) return null;
  return profile;
}

/** HTTP custom tools activos por org+ids — uma leitura por turno. */
export async function getCachedNativeHttpCustomTools(
  organizationId: string,
  toolIds: string[],
): Promise<CachedNativeHttpCustomToolRow[]> {
  if (toolIds.length === 0) return [];
  const cacheKey = `${organizationId}:${[...toolIds].sort().join(",")}`;
  const store = getStore();
  if (store?.customToolsByKey.has(cacheKey)) {
    return await store.customToolsByKey.get(cacheKey)!;
  }
  const promise = prisma.automationCustomTool
    .findMany({
      where: { organizationId, id: { in: toolIds }, isActive: true },
      select: NATIVE_HTTP_CUSTOM_TOOL_SELECT,
    })
    .then((rows) => {
      const order = new Map(toolIds.map((id, i) => [id, i]));
      return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    });
  if (store) store.customToolsByKey.set(cacheKey, promise);
  return await promise;
}

export async function getCachedInteractionBudgetRow(
  conversationId: string,
): Promise<CachedInteractionBudgetRow | null> {
  const store = getStore();
  if (store?.interactionBudgetByConversation.has(conversationId)) {
    return await store.interactionBudgetByConversation.get(conversationId)!;
  }
  const promise = prisma.conversationInteractionBudget
    .findUnique({
      where: { conversationId },
      select: { interactionCount: true, status: true },
    })
    .then((row) => row ?? null);
  if (store) store.interactionBudgetByConversation.set(conversationId, promise);
  return await promise;
}

export function primeCachedInteractionBudgetRow(
  conversationId: string,
  row: CachedInteractionBudgetRow | null,
): void {
  const store = getStore();
  if (!store) return;
  store.interactionBudgetByConversation.set(conversationId, Promise.resolve(row));
}

export function invalidateCachedInteractionBudgetRow(conversationId: string): void {
  const store = getStore();
  if (!store) return;
  store.interactionBudgetByConversation.delete(conversationId);
}

export async function getCachedPlatformSetting(key: string): Promise<PlatformSetting | null> {
  const store = getStore();
  if (store?.platformSettingsByKey.has(key)) {
    return await store.platformSettingsByKey.get(key)!;
  }
  const promise = prisma.platformSetting
    .findUnique({ where: { key } })
    .then((row) => row ?? null);
  if (store) store.platformSettingsByKey.set(key, promise);
  return await promise;
}

export async function getCachedOrganization(
  organizationId: string,
): Promise<Organization | null> {
  const store = getStore();
  if (store?.organizationsById.has(organizationId)) {
    return await store.organizationsById.get(organizationId)!;
  }
  const promise = prisma.organization
    .findUnique({ where: { id: organizationId } })
    .then((row) => row ?? null);
  if (store) store.organizationsById.set(organizationId, promise);
  return await promise;
}

export async function getCachedOrganizationSettings(
  organizationId: string,
): Promise<Settings | null> {
  const store = getStore();
  if (store?.settingsByOrg.has(organizationId)) {
    return await store.settingsByOrg.get(organizationId)!;
  }
  const promise = prisma.settings
    .findUnique({ where: { organizationId } })
    .then((row) => row ?? null);
  if (store) store.settingsByOrg.set(organizationId, promise);
  return await promise;
}

/** Histórico nativo (até 20 msgs) — partilhado entre KB (10) e LLM (20) no mesmo turno. */
export async function getCachedNativeAgentMessages(input: {
  conversationId: string;
  excludeMessageId: string;
  excludeMessageIds?: string[];
  lastClearedAt: Date | null;
  take: number;
}): Promise<Array<Pick<Message, "direction" | "body">>> {
  const maxTake = Math.min(20, Math.max(1, input.take));
  const cacheKey = `${input.conversationId}:${input.excludeMessageId ?? ""}:${(input.excludeMessageIds ?? []).join(",")}:${input.lastClearedAt?.toISOString() ?? ""}`;
  const store = getStore();
  let rows: Array<Pick<Message, "direction" | "body">>;
  if (store?.nativeAgentMessages.has(cacheKey)) {
    rows = await store.nativeAgentMessages.get(cacheKey)!;
  } else {
    const promise = prisma.message
      .findMany({
        where: buildNativeAgentMessageWhere({
          conversationId: input.conversationId,
          excludeMessageId: input.excludeMessageId,
          excludeMessageIds: input.excludeMessageIds,
          lastClearedAt: input.lastClearedAt,
        }),
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { direction: true, body: true },
      })
      .then((found) => found.reverse());
    if (store) store.nativeAgentMessages.set(cacheKey, promise);
    rows = await promise;
  }
  if (rows.length <= maxTake) return rows;
  return rows.slice(-maxTake);
}

export async function getCachedKbChunkCount(organizationId: string): Promise<number> {
  const store = getStore();
  if (store?.kbChunkCountByOrg.has(organizationId)) {
    return await store.kbChunkCountByOrg.get(organizationId)!;
  }
  const promise = prisma.automationKnowledgeChunk.count({ where: { organizationId } });
  if (store) store.kbChunkCountByOrg.set(organizationId, promise);
  return await promise;
}

export async function getCachedKbArticleBotCount(botId: string): Promise<number> {
  const store = getStore();
  if (store?.kbArticleBotCountByBot.has(botId)) {
    return await store.kbArticleBotCountByBot.get(botId)!;
  }
  const promise = prisma.automationKnowledgeArticleBot.count({
    where: {
      botId,
      article: { isActive: true, syncToAi: true },
    },
  });
  if (store) store.kbArticleBotCountByBot.set(botId, promise);
  return await promise;
}

export async function getCachedRankedKnowledgeSearch(
  cacheKey: string,
  resolve: () => Promise<CachedRankedKnowledgeSearchResult>,
): Promise<CachedRankedKnowledgeSearchResult> {
  const store = getStore();
  if (!store) return await resolve();
  if (!store.kbSearchByKey.has(cacheKey)) {
    store.kbSearchByKey.set(cacheKey, resolve());
  }
  return await store.kbSearchByKey.get(cacheKey)!;
}
