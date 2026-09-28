export type NetworkRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

/** Perfil para envio WhatsApp Cloud API (Meta) — falhas transitórias como `fetch failed`. */
export const META_CLOUD_HTTP_RETRY: NetworkRetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 12_000,
};

function collectErrorText(err: unknown, depth = 0): string {
  if (depth > 4 || err == null) return "";
  if (typeof err === "string") return err;
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    if (err.name && err.name !== "Error") parts.push(err.name);
    if (err.cause) parts.push(collectErrorText(err.cause, depth + 1));
  } else {
    parts.push(String(err));
  }
  return parts.join(" ");
}

/** Erros transitórios de rede/API que justificam retry antes de marcar FAILED. */
export function isRetryableNetworkError(err: unknown): boolean {
  const combined = collectErrorText(err).trim();
  return (
    /^META_NETWORK_ERROR:/i.test(combined) ||
    /\bfetch failed\b/i.test(combined) ||
    /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN)\b/i.test(combined) ||
    /\bUND_ERR_(CONNECT|HEADERS|BODY|SOCKET)_TIMEOUT\b/i.test(combined) ||
    /\b(ConnectTimeoutError|HeadersTimeoutError|BodyTimeoutError|SocketError)\b/i.test(combined) ||
    /\boperation was aborted\b/i.test(combined) ||
    /\bAbortError\b/i.test(combined) ||
    /\bsocket hang up\b/i.test(combined) ||
    /\bnetwork\b/i.test(combined) ||
    /\bMeta API error: (429|502|503|504)\b/.test(combined)
  );
}

function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(maxDelayMs, exponential + jitter);
}

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  opts?: NetworkRetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(50, opts?.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, opts?.maxDelayMs ?? baseDelayMs * 8);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableNetworkError(err)) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, retryDelayMs(attempt, baseDelayMs, maxDelayMs)),
      );
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
