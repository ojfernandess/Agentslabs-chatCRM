import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db.js";
import {
  orgMemoryStoreKey,
  parseOrgMemoryStore,
} from "./parseMemoryEngineConfig.js";
import {
  normalizeMemoryRecord,
  newMemoryId,
  type MemoryRecord,
  type MemoryScope,
  type OrgMemoryStore,
} from "./memoryEngineTypes.js";

type ScopeRef = {
  organizationId: string;
  scope: MemoryScope;
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
};

function parseRecords(raw: unknown): MemoryRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!text) return null;
      return normalizeMemoryRecord({
        id: typeof row.id === "string" ? row.id : newMemoryId(),
        category: row.category as MemoryRecord["category"],
        text,
        origin: row.origin as MemoryRecord["origin"],
        confidence: typeof row.confidence === "number" ? row.confidence : 0.7,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : undefined,
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
        lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
        useCount: typeof row.useCount === "number" ? row.useCount : 0,
        status: row.status as MemoryRecord["status"],
        scope: row.scope as MemoryRecord["scope"],
        score: typeof row.score === "number" ? row.score : 0.6,
        metadata:
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : undefined,
      });
    })
    .filter((x): x is MemoryRecord => x != null);
}

function memoryKeyForScope(scope: MemoryScope): string {
  switch (scope) {
    case "temporary":
      return "temporaryMemories";
    case "contact":
      return "contactMemories";
    case "agent":
      return "agentMemories";
    case "global":
      return "globalMemories";
    default:
      return "contactMemories";
  }
}

async function readContactState(ref: ScopeRef): Promise<Record<string, unknown>> {
  if (!ref.conversationId) return {};
  const row = await prisma.automationConversationContext.findFirst({
    where: { conversationId: ref.conversationId, organizationId: ref.organizationId },
    select: { state: true },
  });
  return row?.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
}

async function writeContactState(ref: ScopeRef, state: Record<string, unknown>): Promise<void> {
  if (!ref.conversationId) return;
  await prisma.automationConversationContext.updateMany({
    where: { conversationId: ref.conversationId, organizationId: ref.organizationId },
    data: { state: state as Prisma.InputJsonValue },
  });
}

async function readAgentStore(ref: ScopeRef): Promise<MemoryRecord[]> {
  if (!ref.botId) return [];
  const profile = await prisma.automationAgentProfile.findFirst({
    where: { botId: ref.botId, organizationId: ref.organizationId },
    select: { behaviorConfig: true },
  });
  const beh =
    profile?.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? (profile.behaviorConfig as Record<string, unknown>)
      : {};
  const store = beh.memoryEngineStore;
  if (!store || typeof store !== "object") return [];
  return parseRecords((store as Record<string, unknown>).agentMemories);
}

async function writeAgentStore(ref: ScopeRef, records: MemoryRecord[]): Promise<void> {
  if (!ref.botId) return;
  const profile = await prisma.automationAgentProfile.findFirst({
    where: { botId: ref.botId, organizationId: ref.organizationId },
    select: { id: true, behaviorConfig: true },
  });
  if (!profile) return;
  const beh =
    profile.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? (profile.behaviorConfig as Record<string, unknown>)
      : {};
  await prisma.automationAgentProfile.update({
    where: { id: profile.id },
    data: {
      behaviorConfig: {
        ...beh,
        memoryEngineStore: {
          agentMemories: records,
          updatedAt: new Date().toISOString(),
        },
      } as Prisma.InputJsonValue,
    },
  });
}

export async function loadOrgMemoryStore(organizationId: string): Promise<OrgMemoryStore> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: orgMemoryStoreKey(organizationId) },
    select: { value: true },
  });
  return parseOrgMemoryStore(row?.value);
}

export async function saveOrgMemoryStore(organizationId: string, store: OrgMemoryStore): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: orgMemoryStoreKey(organizationId) },
    create: {
      key: orgMemoryStoreKey(organizationId),
      value: { ...store, updatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
    update: {
      value: { ...store, updatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });
}

export async function listScopeMemories(ref: ScopeRef): Promise<MemoryRecord[]> {
  if (ref.scope === "global") {
    const org = await loadOrgMemoryStore(ref.organizationId);
    return org.globalMemories.map((m) => ({ ...m, scope: "global" as const }));
  }
  if (ref.scope === "agent") {
    return (await readAgentStore(ref)).map((m) => ({ ...m, scope: "agent" as const }));
  }
  const state = await readContactState(ref);
  const engine =
    state.memoryEngine && typeof state.memoryEngine === "object"
      ? (state.memoryEngine as Record<string, unknown>)
      : {};
  const key = memoryKeyForScope(ref.scope);
  return parseRecords(engine[key]).map((m) => ({ ...m, scope: ref.scope }));
}

export async function saveScopeMemories(ref: ScopeRef, records: MemoryRecord[]): Promise<void> {
  if (ref.scope === "global") {
    const org = await loadOrgMemoryStore(ref.organizationId);
    org.globalMemories = records.map((m) => ({ ...m, scope: "global" }));
    await saveOrgMemoryStore(ref.organizationId, org);
    return;
  }
  if (ref.scope === "agent") {
    await writeAgentStore(ref, records.map((m) => ({ ...m, scope: "agent" })));
    return;
  }
  const state = await readContactState(ref);
  const engine =
    state.memoryEngine && typeof state.memoryEngine === "object"
      ? (state.memoryEngine as Record<string, unknown>)
      : {};
  const key = memoryKeyForScope(ref.scope);
  await writeContactState(ref, {
    ...state,
    memoryEngine: {
      ...engine,
      [key]: records.map((m) => ({ ...m, scope: ref.scope })),
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function upsertScopeMemory(
  ref: ScopeRef,
  record: MemoryRecord,
): Promise<{ records: MemoryRecord[]; created: boolean; updated: MemoryRecord | null }> {
  const existing = await listScopeMemories(ref);
  const idx = existing.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = { ...existing[idx], ...record, updatedAt: new Date().toISOString() };
    await saveScopeMemories(ref, next);
    return { records: next, created: false, updated: next[idx] };
  }
  const next = [...existing, record];
  await saveScopeMemories(ref, next);
  return { records: next, created: true, updated: record };
}

export async function deleteScopeMemory(ref: ScopeRef, id: string): Promise<boolean> {
  const existing = await listScopeMemories(ref);
  const next = existing.filter((r) => r.id !== id);
  if (next.length === existing.length) return false;
  await saveScopeMemories(ref, next);
  return true;
}

export async function clearScopeMemories(ref: ScopeRef): Promise<number> {
  const existing = await listScopeMemories(ref);
  await saveScopeMemories(ref, []);
  return existing.length;
}
