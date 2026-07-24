import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db.js";
import type { AgentMemoryKind } from "../types.js";
import {
  buildMemoryContextAppendix,
  estimateMemoryTokens,
  mergeMemoryHierarchy,
  summarizeMemoryRecords,
} from "./MemoryContextBuilder.js";
import { extractMemoryCandidates } from "./MemoryExtractor.js";
import {
  applyDuplicateUpdate,
  applyRetention,
  findDuplicateMemory,
  trimMemoriesToLimit,
  validateMemoryCandidate,
} from "./MemoryValidator.js";
import {
  buildCreatedEvent,
  buildLoadedEvent,
  buildUpdatedEvent,
} from "./MemoryObservability.js";
import {
  loadOrgMemoryStore,
  listScopeMemories,
  saveScopeMemories,
  deleteScopeMemory,
  clearScopeMemories,
  upsertScopeMemory,
} from "./openNexoMemoryRepository.js";
import { parseMemoryCenterFromState } from "./memoryCenterTypes.js";
import {
  resolveMem0EntityContext,
  syncTurnToMem0,
} from "./mem0MemoryBridge.js";
import {
  isMem0Configured,
  mem0AddDirectMemory,
  mem0DeleteMemory,
  mem0ListMemories,
  mem0SearchMemories,
  type Mem0MemoryRecord,
} from "./mem0Client.js";
import {
  normalizeMemoryRecord,
  newMemoryId,
  type MemoryClearInput,
  type MemoryDeleteInput,
  type MemoryEngineConfig,
  type MemoryExecutionContext,
  type MemoryExecutionContextInput,
  type MemoryListInput,
  type MemoryRecord,
  type MemorySaveInput,
  type MemorySearchQuery,
  type MemorySummarizeInput,
  type MemoryTurnSaveInput,
  type MemoryTurnSaveResult,
  type MemoryUpdateInput,
  type MemoryObservabilityEvent,
} from "./memoryEngineTypes.js";

/** Interface única do OpenNexo Memory Engine — nunca aceder Mem0 directamente fora dos adapters. */
export interface MemoryProvider {
  readonly kind: AgentMemoryKind;
  save(input: MemorySaveInput): Promise<MemoryRecord>;
  search(query: MemorySearchQuery): Promise<MemoryRecord[]>;
  delete(input: MemoryDeleteInput): Promise<boolean>;
  update(input: MemoryUpdateInput): Promise<MemoryRecord | null>;
  list(input: MemoryListInput): Promise<MemoryRecord[]>;
  clear(input: MemoryClearInput): Promise<number>;
  summarize(input: MemorySummarizeInput): Promise<string>;
  loadExecutionContext(input: MemoryExecutionContextInput): Promise<MemoryExecutionContext>;
  saveTurn(input: MemoryTurnSaveInput): Promise<MemoryTurnSaveResult>;
  /** Compatibilidade com orchestration legado. */
  load(conversationId: string, organizationId: string): Promise<Record<string, unknown>>;
  saveLegacy(
    conversationId: string,
    organizationId: string,
    patch: Record<string, unknown>,
  ): Promise<void>;
}

function scopeRef(input: {
  organizationId: string;
  scope: MemoryRecord["scope"];
  conversationId?: string | null;
  botId?: string | null;
  contactId?: string | null;
}) {
  return {
    organizationId: input.organizationId,
    scope: input.scope,
    conversationId: input.conversationId,
    botId: input.botId,
    contactId: input.contactId,
  };
}

function mem0ToRecord(row: Mem0MemoryRecord, scope: MemoryRecord["scope"]): MemoryRecord {
  return normalizeMemoryRecord({
    id: row.id,
    text: row.memory,
    category: "knowledge",
    origin: "agent",
    confidence: typeof row.score === "number" ? row.score : 0.75,
    score: typeof row.score === "number" ? row.score : 0.7,
    scope,
    createdAt: row.createdAt,
  });
}

function filterSearch(records: MemoryRecord[], query: MemorySearchQuery): MemoryRecord[] {
  let out = records.filter((r) => r.status !== "archived" || query.includeArchived);
  if (query.categories?.length) {
    out = out.filter((r) => query.categories!.includes(r.category));
  }
  if (typeof query.minConfidence === "number") {
    out = out.filter((r) => r.confidence >= query.minConfidence!);
  }
  if (typeof query.minScore === "number") {
    out = out.filter((r) => r.score >= query.minScore!);
  }
  const q = (query.query ?? "").trim().toLowerCase();
  if (q) {
    out = out.filter((r) => r.text.toLowerCase().includes(q));
  }
  const limit = query.limit ?? 20;
  return out.slice(0, limit);
}

/** Implementação OpenNexo (state local + repositório por scope). */
export class OpenNexoMemoryProvider implements MemoryProvider {
  readonly kind = "openconduit" as const;

  async save(input: MemorySaveInput): Promise<MemoryRecord> {
    const record = normalizeMemoryRecord(
      { ...input.record, scope: input.scope },
      { scope: input.scope, origin: input.record.origin ?? "manual" },
    );
    await upsertScopeMemory(scopeRef(input), record);
    return record;
  }

  async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
    const rows = await listScopeMemories(scopeRef(query));
    return filterSearch(rows, query);
  }

  async delete(input: MemoryDeleteInput): Promise<boolean> {
    return deleteScopeMemory(scopeRef(input), input.id);
  }

  async update(input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    const rows = await listScopeMemories(scopeRef(input));
    const idx = rows.findIndex((r) => r.id === input.id);
    if (idx < 0) return null;
    const next = { ...rows[idx], ...input.patch, updatedAt: new Date().toISOString() };
    await saveScopeMemories(scopeRef(input), rows.map((r, i) => (i === idx ? next : r)));
    return next;
  }

  async list(input: MemoryListInput): Promise<MemoryRecord[]> {
    return this.search({ ...input, query: undefined });
  }

  async clear(input: MemoryClearInput): Promise<number> {
    if (input.categories?.length) {
      const rows = await listScopeMemories(scopeRef(input));
      const next = rows.filter((r) => !input.categories!.includes(r.category));
      const removed = rows.length - next.length;
      await saveScopeMemories(scopeRef(input), next);
      return removed;
    }
    return clearScopeMemories(scopeRef(input));
  }

  async summarize(input: MemorySummarizeInput): Promise<string> {
    const rows = await this.list({ ...input, limit: input.maxItems ?? 12 });
    return summarizeMemoryRecords(rows, input.maxItems ?? 12);
  }

  async loadExecutionContext(input: MemoryExecutionContextInput): Promise<MemoryExecutionContext> {
    const started = Date.now();
    if (!input.config.intelligentMemoryEnabled) {
      return {
        appendix: "",
        records: [],
        hierarchy: { temporary: [], contact: [], agent: [], global: [] },
        loadedCount: 0,
        latencyMs: 0,
      };
    }

    const [temporary, contact, agent, global] = await Promise.all([
      listScopeMemories(scopeRef({ ...input, scope: "temporary" })),
      listScopeMemories(scopeRef({ ...input, scope: "contact" })),
      listScopeMemories(scopeRef({ ...input, scope: "agent" })),
      listScopeMemories(scopeRef({ ...input, scope: "global" })),
    ]);

    const legacy = await this.load(input.conversationId, input.organizationId);
    const legacyMemories = Array.isArray(legacy.aiMemories)
      ? (legacy.aiMemories as Array<{ id?: string; text: string; source?: string; createdAt?: string }>).map(
          (m) =>
            normalizeMemoryRecord({
              id: m.id ?? newMemoryId("legacy"),
              text: m.text,
              category: "preferences",
              origin: m.source === "manual" ? "manual" : "agent",
              scope: "contact",
            }),
        )
      : [];

    const mergedContact = [...contact, ...legacyMemories];
    const { hierarchy, ranked } = mergeMemoryHierarchy({
      temporary,
      contact: mergedContact,
      agent,
      global,
      userMessage: input.userMessage,
    });

    const records = ranked.slice(0, input.config.maxMemories);
    const latencyMs = Date.now() - started;
    return {
      appendix: buildMemoryContextAppendix(hierarchy),
      records,
      hierarchy,
      loadedCount: records.length,
      latencyMs,
    };
  }

  async saveTurn(input: MemoryTurnSaveInput): Promise<MemoryTurnSaveResult> {
    const events: MemoryObservabilityEvent[] = [];
    const created: MemoryRecord[] = [];
    const updated: MemoryRecord[] = [];
    let skipped = 0;

    if (!input.config.autoSaveEnabled || !input.config.intelligentMemoryEnabled) {
      return { created, updated, skipped, events };
    }

    const orgStore = await loadOrgMemoryStore(input.organizationId);
    const candidates = extractMemoryCandidates(input.userMessage, input.assistantMessage);
    const contactRows = await listScopeMemories(scopeRef({ ...input, scope: "contact" }));

    for (const candidate of candidates) {
      const validation = validateMemoryCandidate({
        text: candidate.text,
        category: candidate.category,
        confidence: candidate.confidence,
        config: input.config,
        orgConfig: orgStore.config,
      });
      if (!validation.ok) {
        skipped += 1;
        continue;
      }

      const dup = findDuplicateMemory(contactRows, candidate.text, candidate.category);
      if (dup) {
        const next = applyDuplicateUpdate(dup, candidate);
        await upsertScopeMemory(scopeRef({ ...input, scope: "contact" }), next);
        updated.push(next);
        events.push(buildUpdatedEvent({ scope: "contact", memoryId: next.id, category: next.category }));
        continue;
      }

      const record = normalizeMemoryRecord({
        text: candidate.text,
        category: candidate.category,
        origin: "agent",
        confidence: candidate.confidence,
        scope: "contact",
      });
      await upsertScopeMemory(scopeRef({ ...input, scope: "contact" }), record);
      created.push(record);
      events.push(
        buildCreatedEvent({
          scope: "contact",
          category: record.category,
          origin: record.origin,
          memoryId: record.id,
        }),
      );
    }

    const allContact = await listScopeMemories(scopeRef({ ...input, scope: "contact" }));
    const trimmed = trimMemoriesToLimit(
      orgStore.config.autoCleanup
        ? applyRetention(allContact, orgStore.config.retentionDays)
        : allContact,
      Math.min(input.config.maxMemories, orgStore.config.maxMemories),
    );
    if (trimmed.length !== allContact.length) {
      await saveScopeMemories(scopeRef({ ...input, scope: "contact" }), trimmed);
    }

    return { created, updated, skipped, events };
  }

  async load(conversationId: string, organizationId: string): Promise<Record<string, unknown>> {
    const row = await prisma.automationConversationContext.findFirst({
      where: { conversationId, organizationId },
      select: { state: true, updatedAt: true, botId: true },
    });
    const state =
      row?.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
    const mc = parseMemoryCenterFromState(state);
    const contactMemories = await listScopeMemories({
      organizationId,
      scope: "contact",
      conversationId,
      botId: row?.botId,
    });
    return {
      flowSlots: state.flowSlots ?? {},
      preferences: mc.preferences ?? {},
      aiMemories:
        contactMemories.length > 0
          ? contactMemories.map((m) => ({
              id: m.id,
              text: m.text,
              source: m.origin === "manual" ? "manual" : "agent",
              createdAt: m.createdAt,
            }))
          : (mc.aiMemories ?? []),
      tags: state.tags ?? [],
      score: mc.score ?? null,
      lastInteractionAt: mc.lastInteractionAt ?? row?.updatedAt?.toISOString() ?? null,
      memoryRecords: contactMemories,
    };
  }

  async saveLegacy(
    conversationId: string,
    organizationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const row = await prisma.automationConversationContext.findFirst({
      where: { conversationId, organizationId },
      select: { id: true, state: true, botId: true },
    });
    if (!row) return;

    const behaviorConfig = await prisma.automationAgentProfile.findFirst({
      where: { botId: row.botId ?? "", organizationId },
      select: { behaviorConfig: true },
    });
    const { parseMemoryEngineConfig } = await import("./parseMemoryEngineConfig.js");
    const memCfg = parseMemoryEngineConfig(behaviorConfig?.behaviorConfig);

    const userMessage =
      typeof patch.userMessage === "string"
        ? patch.userMessage
        : typeof patch.inboundMessage === "string"
          ? patch.inboundMessage
          : "";
    const assistantMessage =
      typeof patch.assistantMessage === "string"
        ? patch.assistantMessage
        : typeof patch.lastReplyPreview === "string"
          ? patch.lastReplyPreview
          : "";

    if (userMessage.trim() || assistantMessage.trim()) {
      await this.saveTurn({
        organizationId,
        conversationId,
        botId: typeof patch.botId === "string" ? patch.botId : (row.botId ?? ""),
        contactId: typeof patch.contactId === "string" ? patch.contactId : null,
        userMessage,
        assistantMessage,
        config: memCfg,
      });
    }

    const prev =
      row.state && typeof row.state === "object" ? (row.state as Record<string, unknown>) : {};
    await prisma.automationConversationContext.update({
      where: { conversationId },
      data: { state: { ...prev, agentEngineMemory: patch } as Prisma.InputJsonValue },
    });
  }
}

/** Adapter Mem0 — delega persistência remota mas expõe a mesma interface. */
export class Mem0MemoryProvider implements MemoryProvider {
  readonly kind = "mem0" as const;
  private readonly local = new OpenNexoMemoryProvider();

  private async mem0Ctx(input: {
    organizationId: string;
    conversationId?: string | null;
    botId?: string | null;
    contactId?: string | null;
  }) {
    if (!input.conversationId) return null;
    return resolveMem0EntityContext({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      botId: input.botId,
      contactId: input.contactId,
    });
  }

  async save(input: MemorySaveInput): Promise<MemoryRecord> {
    const saved = await this.local.save(input);
    if (isMem0Configured() && input.scope === "contact") {
      const ctx = await this.mem0Ctx(input);
      if (ctx) {
        await mem0AddDirectMemory({
          userId: ctx.userId,
          agentId: ctx.agentId,
          content: saved.text,
          metadata: { category: saved.category, origin: saved.origin },
        });
      }
    }
    return saved;
  }

  async search(query: MemorySearchQuery): Promise<MemoryRecord[]> {
    const localRows = await this.local.search(query);
    if (!isMem0Configured() || query.scope !== "contact") return localRows;
    const ctx = await this.mem0Ctx(query);
    if (!ctx) return localRows;
    try {
      const remote = await mem0SearchMemories({
        userId: ctx.userId,
        agentId: ctx.agentId,
        query: query.query ?? "",
        topK: query.limit ?? 20,
      });
      const mapped = remote.map((r) => mem0ToRecord(r, "contact"));
      const byId = new Map<string, MemoryRecord>();
      for (const row of [...mapped, ...localRows]) byId.set(row.id, row);
      return filterSearch([...byId.values()], query);
    } catch {
      return localRows;
    }
  }

  async delete(input: MemoryDeleteInput): Promise<boolean> {
    if (isMem0Configured()) {
      try {
        await mem0DeleteMemory(input.id);
      } catch {
        /* fallback local */
      }
    }
    return this.local.delete(input);
  }

  async update(input: MemoryUpdateInput): Promise<MemoryRecord | null> {
    return this.local.update(input);
  }

  async list(input: MemoryListInput): Promise<MemoryRecord[]> {
    const localRows = await this.local.list(input);
    if (!isMem0Configured() || input.scope !== "contact") return localRows;
    const ctx = await this.mem0Ctx(input);
    if (!ctx) return localRows;
    try {
      const remote = await mem0ListMemories({
        userId: ctx.userId,
        agentId: ctx.agentId,
        topK: input.limit ?? 20,
      });
      const mapped = remote.map((r) => mem0ToRecord(r, "contact"));
      const byId = new Map<string, MemoryRecord>();
      for (const row of [...mapped, ...localRows]) byId.set(row.id, row);
      return [...byId.values()].slice(0, input.limit ?? 20);
    } catch {
      return localRows;
    }
  }

  async clear(input: MemoryClearInput): Promise<number> {
    return this.local.clear(input);
  }

  async summarize(input: MemorySummarizeInput): Promise<string> {
    const rows = await this.list({ ...input, limit: input.maxItems ?? 12 });
    return summarizeMemoryRecords(rows, input.maxItems ?? 12);
  }

  async loadExecutionContext(input: MemoryExecutionContextInput): Promise<MemoryExecutionContext> {
    const started = Date.now();
    const base = await this.local.loadExecutionContext(input);
    if (!isMem0Configured()) return base;

    const ctx = await this.mem0Ctx(input);
    if (!ctx) return base;

    try {
      const searched = await mem0SearchMemories({
        userId: ctx.userId,
        agentId: ctx.agentId,
        query: input.userMessage,
        topK: Math.min(15, input.config.maxMemories),
      });
      const remote = searched.map((r) => mem0ToRecord(r, "contact"));
      const { hierarchy, ranked } = mergeMemoryHierarchy({
        ...base.hierarchy,
        contact: [...base.hierarchy.contact, ...remote],
        userMessage: input.userMessage,
      });
      const records = ranked.slice(0, input.config.maxMemories);
      return {
        appendix: buildMemoryContextAppendix(hierarchy),
        records,
        hierarchy,
        loadedCount: records.length,
        latencyMs: Date.now() - started,
      };
    } catch {
      return base;
    }
  }

  async saveTurn(input: MemoryTurnSaveInput): Promise<MemoryTurnSaveResult> {
    const result = await this.local.saveTurn(input);
    if (isMem0Configured() && input.config.autoSaveEnabled) {
      await syncTurnToMem0({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        botId: input.botId,
        contactId: input.contactId,
        userMessage: input.userMessage,
        assistantMessage: input.assistantMessage,
      });
    }
    return result;
  }

  async load(conversationId: string, organizationId: string): Promise<Record<string, unknown>> {
    return this.local.load(conversationId, organizationId);
  }

  async saveLegacy(
    conversationId: string,
    organizationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await this.local.saveLegacy(conversationId, organizationId, patch);
  }
}

export function createMemoryProvider(kind: AgentMemoryKind): MemoryProvider {
  if (kind === "mem0") return new Mem0MemoryProvider();
  return new OpenNexoMemoryProvider();
}

/** Serviço de fachada para runtimes — Dependency Injection entry point. */
export class MemoryEngineService {
  constructor(private readonly provider: MemoryProvider) {}

  static fromKind(kind: AgentMemoryKind): MemoryEngineService {
    return new MemoryEngineService(createMemoryProvider(kind));
  }

  get providerKind(): AgentMemoryKind {
    return this.provider.kind;
  }

  loadContext(input: MemoryExecutionContextInput): Promise<MemoryExecutionContext> {
    return this.provider.loadExecutionContext(input);
  }

  saveTurn(input: MemoryTurnSaveInput): Promise<MemoryTurnSaveResult> {
    return this.provider.saveTurn(input);
  }

  loadLegacy(conversationId: string, organizationId: string) {
    return this.provider.load(conversationId, organizationId);
  }

  saveLegacy(conversationId: string, organizationId: string, patch: Record<string, unknown>) {
    return this.provider.saveLegacy(conversationId, organizationId, patch);
  }

  get delegate(): MemoryProvider {
    return this.provider;
  }
}

export function buildMemoryLoadedObservability(ctx: MemoryExecutionContext) {
  return buildLoadedEvent({
    count: ctx.loadedCount,
    latencyMs: ctx.latencyMs,
    tokensEstimate: estimateMemoryTokens(ctx.records),
  });
}

/** @deprecated use MemoryValidator.isCasualText */
export function filterMem0Relevant(patch: Record<string, unknown>): unknown[] {
  const raw = patch.aiMemories ?? patch.memories ?? patch;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => {
    if (typeof item !== "object" || !item) return false;
    const text = String((item as Record<string, unknown>).text ?? "").trim();
    return text.length >= 20;
  });
}
