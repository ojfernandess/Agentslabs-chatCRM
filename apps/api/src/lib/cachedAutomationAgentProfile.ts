import { AsyncLocalStorage } from "node:async_hooks";
import type { AutomationAgentProfile } from "@prisma/client";
import { prisma } from "../db.js";

type AgentTurnCache = {
  profilesByBotId: Map<string, Promise<AutomationAgentProfile | null>>;
};

const als = new AsyncLocalStorage<AgentTurnCache>();

export async function runWithAgentTurnLookupCache<T>(botId: string, fn: () => Promise<T>): Promise<T> {
  const parent = als.getStore();
  if (parent) {
    return await fn();
  }
  const store: AgentTurnCache = { profilesByBotId: new Map() };
  return await als.run(store, fn);
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
