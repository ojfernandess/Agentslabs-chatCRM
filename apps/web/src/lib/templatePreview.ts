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

export function maxBodyPlaceholderIndex(body: string): number {
  const indices = extractBodyPlaceholderIndices(body);
  return indices.length > 0 ? indices[indices.length - 1] : 0;
}

export function substituteBodyPlaceholders(body: string, valuesByIndex: Record<number, string>): string {
  let out = body ?? "";
  for (const [index, value] of Object.entries(valuesByIndex)) {
    const n = Number(index);
    if (!Number.isFinite(n) || n < 1) continue;
    const re = new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, "g");
    out = out.replace(re, value || `{{${n}}}`);
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
