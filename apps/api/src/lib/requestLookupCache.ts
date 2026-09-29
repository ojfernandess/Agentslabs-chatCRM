import { AsyncLocalStorage } from "node:async_hooks";
import type { AutoTagRule, Bot, Inbox, Settings } from "@prisma/client";
import { prisma } from "../db.js";
export type CachedInboxRow = Inbox & { agentBot: Bot | null };
export type CachedOrganizationSettings = Settings & { agentBot: Bot | null };

type CacheStore = {
  inboxById: Map<string, CachedInboxRow | null>;
  organizationSettings: Map<string, Promise<CachedOrganizationSettings | null>>;
  autoTagRules: Map<string, Promise<AutoTagRule[]>>;
  whatsappBundles: Map<string, Promise<unknown>>;
};

const als = new AsyncLocalStorage<CacheStore>();

function getStore(): CacheStore | undefined {
  return als.getStore();
}

function inboxKey(organizationId: string, inboxId: string): string {
  return `${organizationId}:${inboxId}`;
}

export async function runWithRequestLookupCache<T>(fn: () => Promise<T>): Promise<T> {
  const parent = getStore();
  if (parent) {
    return await fn();
  }
  const store: CacheStore = {
    inboxById: new Map(),
    organizationSettings: new Map(),
    autoTagRules: new Map(),
    whatsappBundles: new Map(),
  };
  return await als.run(store, fn);
}

export async function getCachedInboxWithAgentBot(
  organizationId: string,
  inboxId: string,
): Promise<CachedInboxRow | null> {
  const store = getStore();
  const key = inboxKey(organizationId, inboxId);
  if (store?.inboxById.has(key)) {
    return store.inboxById.get(key) ?? null;
  }

  const row = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    include: { agentBot: true },
  });

  if (store) {
    store.inboxById.set(key, row);
  }
  return row;
}

export async function getCachedOrganizationSettings(
  organizationId: string,
): Promise<CachedOrganizationSettings | null> {
  const store = getStore();
  if (store?.organizationSettings.has(organizationId)) {
    return await store.organizationSettings.get(organizationId)!;
  }

  const promise = prisma.settings.findUnique({
    where: { organizationId },
    include: { agentBot: true },
  });

  if (store) {
    store.organizationSettings.set(organizationId, promise);
  }
  return await promise;
}

export async function getCachedAutoTagRules(organizationId: string): Promise<AutoTagRule[]> {
  const store = getStore();
  if (store?.autoTagRules.has(organizationId)) {
    return await store.autoTagRules.get(organizationId)!;
  }

  const promise = prisma.autoTagRule.findMany({ where: { organizationId } });
  if (store) {
    store.autoTagRules.set(organizationId, promise);
  }
  return await promise;
}

export async function getCachedWhatsAppProviderBundle<T>(
  organizationId: string,
  inboxId: string,
  loader: () => Promise<T>,
): Promise<T> {
  const store = getStore();
  const key = inboxKey(organizationId, inboxId);
  if (store?.whatsappBundles.has(key)) {
    return (await store.whatsappBundles.get(key)!) as T;
  }

  const promise = loader();
  if (store) {
    store.whatsappBundles.set(key, promise);
  }
  return await promise;
}
