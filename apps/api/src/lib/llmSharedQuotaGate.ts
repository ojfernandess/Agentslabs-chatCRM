import { createHash } from "node:crypto";

export type LlmQuotaGateStats = {
  key: string;
  inFlight: number;
  queued: number;
  maxConcurrent: number;
  cooldownUntilMs: number;
};

type Waiter = {
  settled: boolean;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
};

type Gate = {
  inFlight: number;
  maxConcurrent: number;
  cooldownUntilMs: number;
  waiters: Waiter[];
  wakeTimer: ReturnType<typeof setTimeout> | null;
};

const gates = new Map<string, Gate>();

let defaultMaxConcurrent = 2;
let defaultMaxQueueWaitMs = 90_000;

/** Configurável em runtime / testes (também via `configureLlmQuotaGateDefaults`). */
export function configureLlmQuotaGateDefaults(opts: {
  maxConcurrent?: number;
  maxQueueWaitMs?: number;
}): void {
  if (opts.maxConcurrent != null) {
    defaultMaxConcurrent = Math.max(1, Math.min(32, Math.floor(opts.maxConcurrent)));
  }
  if (opts.maxQueueWaitMs != null) {
    defaultMaxQueueWaitMs = Math.max(1_000, Math.min(300_000, Math.floor(opts.maxQueueWaitMs)));
  }
  for (const gate of gates.values()) {
    gate.maxConcurrent = defaultMaxConcurrent;
  }
}

/** Fingerprint estável da chave — não expõe o secret em logs/métricas. */
export function llmQuotaGateKey(provider: string, apiKey: string): string {
  const p = (provider || "openai").trim().toLowerCase() || "openai";
  const hash = createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 24);
  return `${p}:${hash}`;
}

function getGate(key: string): Gate {
  let gate = gates.get(key);
  if (!gate) {
    gate = {
      inFlight: 0,
      maxConcurrent: defaultMaxConcurrent,
      cooldownUntilMs: 0,
      waiters: [],
      wakeTimer: null,
    };
    gates.set(key, gate);
  }
  return gate;
}

function clearWaiter(waiter: Waiter): void {
  if (waiter.timer) clearTimeout(waiter.timer);
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
  }
}

function scheduleCooldownWake(gate: Gate): void {
  if (gate.wakeTimer) {
    clearTimeout(gate.wakeTimer);
    gate.wakeTimer = null;
  }
  const delay = gate.cooldownUntilMs - Date.now();
  if (delay <= 0) {
    promoteWaiters(gate);
    return;
  }
  gate.wakeTimer = setTimeout(() => {
    gate.wakeTimer = null;
    promoteWaiters(gate);
  }, delay + 15);
}

function promoteWaiters(gate: Gate): void {
  while (
    gate.waiters.length > 0 &&
    gate.inFlight < gate.maxConcurrent &&
    Date.now() >= gate.cooldownUntilMs
  ) {
    const waiter = gate.waiters.shift()!;
    if (waiter.settled) continue;
    waiter.settled = true;
    clearWaiter(waiter);
    gate.inFlight += 1;
    waiter.resolve(() => releaseSlot(gate));
  }
}

function releaseSlot(gate: Gate): void {
  gate.inFlight = Math.max(0, gate.inFlight - 1);
  promoteWaiters(gate);
}

/**
 * Marca cooldown partilhado para esta API key (todas as conversas).
 * Evita stampede quando um contacto recebe 429 TPM/RPM.
 */
export function markLlmQuotaCooldown(quotaKey: string, retryAfterMs: number): void {
  if (!quotaKey || retryAfterMs <= 0) return;
  const gate = getGate(quotaKey);
  const until = Date.now() + Math.min(Math.max(0, retryAfterMs), 60_000);
  if (until > gate.cooldownUntilMs) {
    gate.cooldownUntilMs = until;
    scheduleCooldownWake(gate);
  }
}

export function getLlmQuotaGateStats(quotaKey: string): LlmQuotaGateStats {
  const gate = getGate(quotaKey);
  return {
    key: quotaKey,
    inFlight: gate.inFlight,
    queued: gate.waiters.length,
    maxConcurrent: gate.maxConcurrent,
    cooldownUntilMs: gate.cooldownUntilMs,
  };
}

/**
 * Adquire um slot de concorrência LLM para a chave. FIFO entre contactos.
 * Durante tools HTTP o slot é libertado entre rondas (só envolve o fetch).
 */
export async function acquireLlmQuotaSlot(
  quotaKey: string,
  opts?: { signal?: AbortSignal; maxQueueWaitMs?: number },
): Promise<() => void> {
  if (!quotaKey) {
    return () => undefined;
  }
  const gate = getGate(quotaKey);
  const signal = opts?.signal;
  const maxWait = opts?.maxQueueWaitMs ?? defaultMaxQueueWaitMs;

  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  if (gate.inFlight < gate.maxConcurrent && Date.now() >= gate.cooldownUntilMs) {
    gate.inFlight += 1;
    return () => releaseSlot(gate);
  }

  return await new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = {
      settled: false,
      resolve,
      reject,
      signal,
    };

    const fail = (err: Error) => {
      if (waiter.settled) return;
      waiter.settled = true;
      const idx = gate.waiters.indexOf(waiter);
      if (idx >= 0) gate.waiters.splice(idx, 1);
      clearWaiter(waiter);
      reject(err);
    };

    waiter.onAbort = () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      fail(err);
    };
    signal?.addEventListener("abort", waiter.onAbort, { once: true });

    waiter.timer = setTimeout(() => {
      fail(
        new Error(
          `LLM quota gate queue timeout after ${maxWait}ms (inFlight=${gate.inFlight}, queued=${gate.waiters.length})`,
        ),
      );
    }, maxWait);

    gate.waiters.push(waiter);
    scheduleCooldownWake(gate);
    promoteWaiters(gate);
  });
}

export async function withLlmQuotaSlot<T>(
  quotaKey: string,
  fn: () => Promise<T>,
  opts?: { signal?: AbortSignal; maxQueueWaitMs?: number },
): Promise<T> {
  const release = await acquireLlmQuotaSlot(quotaKey, opts);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Cadeia FIFO por conversa — evita duas gerações sobrepostas no mesmo contacto. */
const conversationChains = new Map<string, Promise<unknown>>();

export async function withConversationAgentReplyLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = conversationId.trim();
  if (!id) return fn();

  const previous = conversationChains.get(id) ?? Promise.resolve();
  let releaseHold!: () => void;
  const hold = new Promise<void>((r) => {
    releaseHold = r;
  });
  const chained = previous.catch(() => undefined).then(() => hold);
  conversationChains.set(id, chained);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    releaseHold();
    if (conversationChains.get(id) === chained) {
      conversationChains.delete(id);
    }
  }
}

/** Só para testes. */
export function __resetLlmQuotaGatesForTests(): void {
  for (const gate of gates.values()) {
    if (gate.wakeTimer) clearTimeout(gate.wakeTimer);
    for (const w of gate.waiters) clearWaiter(w);
  }
  gates.clear();
  conversationChains.clear();
  defaultMaxConcurrent = 2;
  defaultMaxQueueWaitMs = 90_000;
}
