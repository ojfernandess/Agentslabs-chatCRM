/**
 * Interpretação global de resultados de tools HTTP — erros de negócio no body.
 */

function readObjectPayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    return readObjectPayload(parsed);
  } catch {
    return null;
  }
}

/** HTTP 200 com validationError / missingFields no body = falha de negócio. */
export function httpToolBodyIndicatesFailure(payload: unknown): boolean {
  const o = readObjectPayload(payload) ?? (typeof payload === "string" ? parseJsonObject(payload) : null);
  if (!o) return false;
  if (o.validationError === true) return true;
  if (o.ok === false) return true;
  if (Array.isArray(o.missingFields) && o.missingFields.length > 0) return true;
  if (typeof o.error === "string" && /schema_validation|embratur_incomplete|validation/i.test(o.error)) {
    return true;
  }
  return false;
}

export function extractHttpToolFailureFromWrapper(parsed: Record<string, unknown>): boolean {
  if (httpToolBodyIndicatesFailure(parsed)) return true;
  const bodyPreview = parsed.bodyPreview;
  if (typeof bodyPreview === "string" && bodyPreview.trim()) {
    return httpToolBodyIndicatesFailure(parseJsonObject(bodyPreview) ?? bodyPreview);
  }
  return false;
}
