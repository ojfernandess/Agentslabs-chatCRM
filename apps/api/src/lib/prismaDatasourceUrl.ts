/** Acrescenta query params ao URL Postgres sem sobrescrever os já definidos. */
export function appendPostgresUrlParams(
  rawUrl: string,
  params: Record<string, string | number>,
): string {
  const qIndex = rawUrl.indexOf("?");
  const base = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;
  const existing = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : "";
  const search = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(params)) {
    if (!search.has(key)) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Resolve `DATABASE_URL` com tuning de pool Prisma (Fase B3).
 * `PRISMA_CONNECTION_LIMIT` / `PRISMA_POOL_TIMEOUT` só aplicam se ausentes no URL.
 */
export function resolvePrismaDatasourceUrl(rawUrl = process.env.DATABASE_URL): string {
  const raw = rawUrl?.trim();
  if (!raw) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  const params: Record<string, string> = {};
  const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT?.trim();
  const poolTimeout = process.env.PRISMA_POOL_TIMEOUT?.trim();

  if (connectionLimit && !/connection_limit=/i.test(raw)) {
    params.connection_limit = connectionLimit;
  }
  if (poolTimeout && !/pool_timeout=/i.test(raw)) {
    params.pool_timeout = poolTimeout;
  }

  return Object.keys(params).length > 0 ? appendPostgresUrlParams(raw, params) : raw;
}
