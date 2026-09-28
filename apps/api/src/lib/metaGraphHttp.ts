/** HTTP resiliente para Graph API (Meta Cloud / 360dialog). */

import { extractFetchErrorDiagnostics } from "./metaSendErrors.js";

const DEFAULT_TIMEOUT_MS = 45_000;

function parseTimeoutMs(): number {
  const raw = process.env.META_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 5_000) return DEFAULT_TIMEOUT_MS;
  return Math.min(n, 120_000);
}

export const META_GRAPH_HTTP_TIMEOUT_MS = parseTimeoutMs();

type FetchFn = typeof fetch;

let cachedFetch: FetchFn | null = null;

async function resolveMetaGraphFetch(): Promise<FetchFn> {
  if (cachedFetch) return cachedFetch;
  try {
    const undiciModule = "undici";
    const undici = (await import(undiciModule)) as {
      Agent: new (opts: Record<string, unknown>) => unknown;
      fetch: typeof fetch;
    };
    const agent = new undici.Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 120_000,
      connections: 32,
      pipelining: 1,
    });
    cachedFetch = ((input: string | URL, init?: RequestInit) =>
      undici.fetch(input, { ...init, dispatcher: agent } as RequestInit)) as FetchFn;
    return cachedFetch;
  } catch {
    cachedFetch = fetch;
    return cachedFetch;
  }
}

export async function metaGraphFetch(url: string, init?: RequestInit): Promise<Response> {
  const fn = await resolveMetaGraphFetch();
  const started = Date.now();
  try {
    return await fn(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(META_GRAPH_HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    const diagnostics = extractFetchErrorDiagnostics(err);
    console.error("[META][SEND][NETWORK_ERROR]", {
      urlHost: safeUrlHost(url),
      durationMs: Date.now() - started,
      ...diagnostics,
    });
    throw err;
  }
}

function safeUrlHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
