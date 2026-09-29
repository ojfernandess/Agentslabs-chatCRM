import { AsyncLocalStorage } from "node:async_hooks";
import type { AutomationAgentProfile } from "@prisma/client";
import { prisma } from "../db.js";

export type CachedAutomationConversationContextRow = {
  id?: string;
  organizationId: string;
  conversationId: string;
  botId: string | null;
  state: unknown;
  lastClearedAt: Date | null;
  updatedAt?: Date | null;
};

type AgentTurnCache = {
  profilesByBotId: Map<string, Promise<AutomationAgentProfile | null>>;
  featureFlags: Map<string, Promise<boolean>>;
  conversationContexts: Map<string, Promise<CachedAutomationConversationContextRow | null>>;
};

const als = new AsyncLocalStorage<AgentTurnCache>();

function createAgentTurnCache(): AgentTurnCache {
  return {
    profilesByBotId: new Map(),
    featureFlags: new Map(),
    conversationContexts: new Map(),
  };
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
