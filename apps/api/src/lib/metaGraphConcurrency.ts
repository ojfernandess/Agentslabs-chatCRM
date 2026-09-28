/** Limita chamadas simultâneas à Graph API — evita ETIMEDOUT por saturação do pool/event loop. */

const DEFAULT_MAX_CONCURRENT = 12;
const DEFAULT_QUEUE_WARN_MS = 2_000;

function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(raw?.trim() ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function getMetaGraphMaxConcurrent(): number {
  return parsePositiveInt(process.env.META_GRAPH_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT, 64);
}

type Waiter = () => void;

let maxConcurrent = getMetaGraphMaxConcurrent();
let active = 0;
const waitQueue: Waiter[] = [];

/** Testes — não usar em produção. */
export function resetMetaGraphConcurrencyForTests(opts?: { maxConcurrent?: number }): void {
  maxConcurrent = opts?.maxConcurrent ?? getMetaGraphMaxConcurrent();
  active = 0;
  waitQueue.length = 0;
}

function acquireSlot(): Promise<number> {
  const started = Date.now();
  if (active < maxConcurrent) {
    active += 1;
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      active += 1;
      resolve(Date.now() - started);
    });
  });
}

function releaseSlot(): void {
  active = Math.max(0, active - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export async function withMetaGraphSlot<T>(fn: () => Promise<T>): Promise<T> {
  const queueWaitMs = await acquireSlot();
  if (queueWaitMs >= DEFAULT_QUEUE_WARN_MS) {
    console.warn("[META][SEND][QUEUE_WAIT]", {
      queueWaitMs,
      active,
      queued: waitQueue.length,
      maxConcurrent,
    });
  }
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}
