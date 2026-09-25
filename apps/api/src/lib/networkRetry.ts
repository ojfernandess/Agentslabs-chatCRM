/** Erros transitórios de rede/API que justificam retry antes de marcar FAILED. */
export function isRetryableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  const combined = `${msg} ${cause}`.trim();
  return (
    /\bfetch failed\b/i.test(combined) ||
    /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)\b/i.test(
      combined,
    ) ||
    /\bsocket hang up\b/i.test(combined) ||
    /\bnetwork\b/i.test(combined) ||
    /\bMeta API error: (429|502|503|504)\b/.test(combined)
  );
}

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<T> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
  const baseDelayMs = Math.max(50, opts?.baseDelayMs ?? 500);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableNetworkError(err)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
