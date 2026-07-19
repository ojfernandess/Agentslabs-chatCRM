import { URL } from "node:url";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata",
]);

function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split(".").map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function assertHttpUrlAllowed(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error("Host not allowed");
  if (host.endsWith(".localhost")) throw new Error("Host not allowed");
  if (isPrivateIpv4(host)) throw new Error("Private network hosts are not allowed");
  return u;
}

export function truncateBody(s: string, max = 24_000): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n… [truncated ${s.length - max} chars]`;
}

const SENSITIVE_HEADER_PATTERN = /authorization|api[-_]?key|token|secret|password|cookie/i;

export function redactSensitiveHeader(name: string, value: string): string {
  if (SENSITIVE_HEADER_PATTERN.test(name)) return "***";
  return value;
}

export function buildToolExecutionRequestSummary(input: {
  method: string;
  url: string;
  headers: Headers;
  bodyStr?: string;
  bodySource?: string;
  bodyMax?: number;
}): Record<string, unknown> {
  const bodyMax = input.bodyMax ?? 16_000;
  const headerEntries: Record<string, string> = {};
  input.headers.forEach((value, key) => {
    headerEntries[key] = redactSensitiveHeader(key, value);
  });
  let query: Record<string, string> = {};
  try {
    query = Object.fromEntries(new URL(input.url).searchParams.entries());
  } catch {
    query = {};
  }
  const body = input.bodyStr ?? null;
  const storedBody = body ? truncateBody(body, bodyMax) : null;
  return {
    method: input.method,
    url: input.url,
    query,
    headers: headerEntries,
    headerKeys: Object.keys(headerEntries),
    bodySource: input.bodySource ?? null,
    bodyBytes: body?.length ?? 0,
    body: storedBody,
    bodyPreview: storedBody,
    bodyTruncated: body != null && body.length > bodyMax,
  };
}

export function buildToolExecutionResponseSummary(responseText: string, max = 16_000): Record<string, unknown> {
  const preview = responseText.slice(0, max);
  return {
    preview,
    truncated: responseText.length > max,
    bytes: responseText.length,
  };
}
