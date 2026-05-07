/** Índice máximo usado em {{n}} no corpo (Meta / Evolution). */
export function maxBodyPlaceholderIndex(body: string): number {
  let max = 0;
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  const s = body ?? "";
  while ((m = re.exec(s)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max;
}

export function substituteBodyPlaceholders(body: string, values: string[]): string {
  let out = body ?? "";
  for (let i = 0; i < values.length; i++) {
    const re = new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g");
    out = out.replace(re, values[i] ?? "");
  }
  return out;
}
