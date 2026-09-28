/** Placeholders {{n}} ou {{nome}} no corpo do modelo. */
const BODY_PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokens na ordem de aparição (ex.: ["1","2"] ou ["nome","pedido"]). */
export function extractBodyPlaceholdersInOrder(body: string): string[] {
  const out: string[] = [];
  const s = body ?? "";
  let m: RegExpExecArray | null;
  const re = new RegExp(BODY_PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(s)) !== null) {
    const token = m[1]?.trim();
    if (token) out.push(token);
  }
  return out;
}

/** Índices {{n}} usados no texto (1-based). */
export function extractBodyPlaceholderIndices(body: string): number[] {
  const found = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body ?? "")) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

export function bodyUsesNamedPlaceholders(body: string): boolean {
  const tokens = extractBodyPlaceholdersInOrder(body);
  return tokens.length > 0 && tokens.some((t) => !/^\d+$/.test(t));
}

export function bodyVariableCount(body: string): number {
  const tokens = extractBodyPlaceholdersInOrder(body);
  if (tokens.length === 0) return 0;
  if (tokens.every((t) => /^\d+$/.test(t))) {
    let max = 0;
    for (const t of tokens) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return max;
  }
  return tokens.length;
}

export function maxBodyPlaceholderIndex(body: string): number {
  return bodyVariableCount(body);
}

export function effectiveBodyVariableCount(body: string, storedCount: number): number {
  return Math.max(storedCount, bodyVariableCount(body));
}

export function substituteBodyPlaceholders(body: string, valuesByIndex: Record<number, string>): string {
  const values = Object.entries(valuesByIndex)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v);
  return substituteBodyPlaceholderValues(body, values);
}

export function substituteBodyPlaceholderValues(body: string, values: string[]): string {
  const tokens = extractBodyPlaceholdersInOrder(body);
  if (tokens.length === 0) return body ?? "";

  let out = body ?? "";
  if (bodyUsesNamedPlaceholders(body)) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const re = new RegExp(`\\{\\{\\s*${escapeRegExp(token)}\\s*\\}\\}`);
      out = out.replace(re, values[i] || `{{${token}}}`);
    }
    return out;
  }

  for (let i = 0; i < values.length; i++) {
    const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g");
    out = out.replace(re, values[i] || `{{${i + 1}}}`);
  }
  return out;
}

export function normalizeTemplateNameInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}
