import MemoryClient from "mem0ai";
import { config } from "../../../config.js";

export type Mem0MemoryRecord = {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type Mem0ClientConfig = {
  apiKey: string;
  baseUrl: string;
};

export function isMem0Configured(cfg: Mem0ClientConfig = readMem0Config()): boolean {
  return Boolean(cfg.apiKey);
}

export function readMem0Config(): Mem0ClientConfig {
  return {
    apiKey: config.mem0ApiKey,
    baseUrl: config.mem0ApiBaseUrl.replace(/\/$/, ""),
  };
}

export function buildMem0UserId(organizationId: string, contactId: string): string {
  return `openconduit:${organizationId}:contact:${contactId}`;
}

export function buildMem0AgentId(organizationId: string, botId: string): string {
  return `openconduit:${organizationId}:bot:${botId}`;
}

let cachedClient: MemoryClient | null = null;
let cachedKey = "";

function getMem0SdkClient(cfg: Mem0ClientConfig = readMem0Config()): MemoryClient {
  if (!cfg.apiKey) {
    throw new Error("mem0_not_configured");
  }
  if (!cachedClient || cachedKey !== `${cfg.apiKey}:${cfg.baseUrl}`) {
    cachedClient = new MemoryClient({ apiKey: cfg.apiKey, host: cfg.baseUrl });
    cachedKey = `${cfg.apiKey}:${cfg.baseUrl}`;
  }
  return cachedClient;
}

function buildEntityFilters(userId: string, agentId?: string): Record<string, unknown> {
  const filters: Record<string, unknown> = { user_id: userId };
  if (agentId) filters.agent_id = agentId;
  return filters;
}

function readIsoDate(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return undefined;
}

function normalizeMem0Results(raw: unknown): Mem0MemoryRecord[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)
      ? ((raw as { results: unknown[] }).results ?? [])
      : [];
  return rows
    .map((item): Mem0MemoryRecord | null => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const memory =
        typeof o.memory === "string"
          ? o.memory.trim()
          : o.data && typeof o.data === "object" && typeof (o.data as Record<string, unknown>).memory === "string"
            ? String((o.data as Record<string, unknown>).memory).trim()
            : "";
      const id =
        typeof o.id === "string"
          ? o.id
          : typeof o.memoryId === "string"
            ? o.memoryId
            : "";
      if (!memory || !id) return null;
      return {
        id,
        memory,
        score: typeof o.score === "number" ? o.score : undefined,
        metadata:
          o.metadata && typeof o.metadata === "object"
            ? (o.metadata as Record<string, unknown>)
            : undefined,
        createdAt: readIsoDate(o.createdAt ?? o.created_at),
        updatedAt: readIsoDate(o.updatedAt ?? o.updated_at),
      };
    })
    .filter((x): x is Mem0MemoryRecord => x !== null);
}

function extractAddEvent(res: unknown): { eventId?: string; status?: string } {
  if (Array.isArray(res)) {
    const first = res[0];
    if (first && typeof first === "object") {
      const o = first as Record<string, unknown>;
      return {
        eventId:
          typeof o.eventId === "string"
            ? o.eventId
            : typeof o.event_id === "string"
              ? o.event_id
              : typeof o.id === "string"
                ? o.id
                : undefined,
        status: typeof o.status === "string" ? o.status : undefined,
      };
    }
    return {};
  }
  if (res && typeof res === "object") {
    const o = res as Record<string, unknown>;
    return {
      eventId:
        typeof o.eventId === "string"
          ? o.eventId
          : typeof o.event_id === "string"
            ? o.event_id
            : undefined,
      status: typeof o.status === "string" ? o.status : undefined,
    };
  }
  return {};
}

export async function mem0AddConversationTurn(input: {
  userId: string;
  agentId?: string;
  userMessage: string;
  assistantMessage: string;
  metadata?: Record<string, unknown>;
  infer?: boolean;
}): Promise<{ eventId?: string; status?: string }> {
  const messages = [
    { role: "user" as const, content: input.userMessage.trim() },
    { role: "assistant" as const, content: input.assistantMessage.trim() },
  ].filter((m) => m.content.length > 0);
  if (messages.length === 0) return {};

  const client = getMem0SdkClient();
  const res = await client.add(messages, {
    userId: input.userId,
    agentId: input.agentId,
    infer: input.infer !== false,
    metadata: {
      source: "openconduit",
      ...(input.metadata ?? {}),
    },
  });
  return extractAddEvent(res);
}

export async function mem0AddDirectMemory(input: {
  userId: string;
  agentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<{ eventId?: string; status?: string }> {
  const text = input.content.trim();
  if (!text) return {};

  const client = getMem0SdkClient();
  const res = await client.add([{ role: "user", content: text }], {
    userId: input.userId,
    agentId: input.agentId,
    infer: false,
    metadata: {
      source: "openconduit_direct",
      ...(input.metadata ?? {}),
    },
  });
  return extractAddEvent(res);
}

export async function mem0SearchMemories(input: {
  userId: string;
  agentId?: string;
  query: string;
  topK?: number;
  threshold?: number;
}): Promise<Mem0MemoryRecord[]> {
  const query = input.query.trim();
  if (!query) return [];

  const client = getMem0SdkClient();
  const res = await client.search(query, {
    filters: buildEntityFilters(input.userId, input.agentId),
    topK: input.topK ?? 8,
    threshold: input.threshold ?? 0.15,
  });
  return normalizeMem0Results(res.results ?? res);
}

export async function mem0ListMemories(input: {
  userId: string;
  agentId?: string;
  topK?: number;
}): Promise<Mem0MemoryRecord[]> {
  const client = getMem0SdkClient();
  const res = await client.getAll({
    filters: buildEntityFilters(input.userId, input.agentId),
    pageSize: input.topK ?? 20,
  });
  return normalizeMem0Results(res.results ?? res);
}

export async function mem0DeleteMemory(memoryId: string): Promise<void> {
  const client = getMem0SdkClient();
  await client.delete(memoryId);
}

export async function mem0UpdateMemory(
  memoryId: string,
  input: { memory: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const client = getMem0SdkClient();
  await client.update(memoryId, {
    text: input.memory,
    metadata: input.metadata,
  });
}

/** Expõe o client SDK para testes ou extensões futuras. */
export function getMem0SdkClientForTests(cfg?: Mem0ClientConfig): MemoryClient {
  return getMem0SdkClient(cfg ?? readMem0Config());
}
