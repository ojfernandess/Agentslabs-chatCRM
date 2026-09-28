/** Placeholders {{n}} ou {{nome}} no corpo do modelo (Meta / Evolution). */
const BODY_PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokens na ordem de aparição no texto (ex.: ["1","2"] ou ["nome","pedido"]). */
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

export function bodyUsesNamedPlaceholders(body: string): boolean {
  const tokens = extractBodyPlaceholdersInOrder(body);
  return tokens.length > 0 && tokens.some((t) => !/^\d+$/.test(t));
}

/** Quantidade de variáveis do corpo (numéricas ou nomeadas). */
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

/** Índice máximo usado em {{n}} no corpo (Meta / Evolution). */
export function maxBodyPlaceholderIndex(body: string): number {
  return bodyVariableCount(body);
}

export function effectiveBodyVariableCount(body: string, storedCount: number): number {
  return Math.max(storedCount, bodyVariableCount(body));
}

export function substituteBodyPlaceholders(body: string, values: string[]): string {
  const tokens = extractBodyPlaceholdersInOrder(body);
  if (tokens.length === 0) return body ?? "";

  let out = body ?? "";
  if (bodyUsesNamedPlaceholders(body)) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const re = new RegExp(`\\{\\{\\s*${escapeRegExp(token)}\\s*\\}\\}`);
      out = out.replace(re, values[i] ?? "");
    }
    return out;
  }

  for (let i = 0; i < values.length; i++) {
    const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g");
    out = out.replace(re, values[i] ?? "");
  }
  return out;
}
