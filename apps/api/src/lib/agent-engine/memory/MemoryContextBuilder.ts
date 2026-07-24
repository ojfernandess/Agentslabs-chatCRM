import type { MemoryRecord } from "./memoryEngineTypes.js";

export function buildMemoryContextAppendix(hierarchy: {
  temporary: MemoryRecord[];
  contact: MemoryRecord[];
  agent: MemoryRecord[];
  global: MemoryRecord[];
}): string {
  const sections: string[] = [];

  const render = (title: string, rows: MemoryRecord[]) => {
    if (rows.length === 0) return;
    const lines = rows.slice(0, 15).map((r, idx) => {
      const cat = r.category.replace(/_/g, " ");
      const pin = r.status === "pinned" ? " [fixada]" : "";
      return `${idx + 1}. (${cat}) ${r.text}${pin}`;
    });
    sections.push(`### ${title}\n${lines.join("\n")}`);
  };

  render("Memória temporária", hierarchy.temporary);
  render("Memória do contacto", hierarchy.contact);
  render("Memória do agente", hierarchy.agent);
  render("Memória global da empresa", hierarchy.global);

  if (sections.length === 0) return "";
  return (
    "\n\n[OpenNexo Memory Engine]\n" +
    "Factos persistentes sobre o contacto, agente e empresa (ignore saudações e dados temporários):\n" +
    sections.join("\n\n")
  );
}

export function mergeMemoryHierarchy(input: {
  temporary: MemoryRecord[];
  contact: MemoryRecord[];
  agent: MemoryRecord[];
  global: MemoryRecord[];
  userMessage?: string;
}): {
  hierarchy: {
    temporary: MemoryRecord[];
    contact: MemoryRecord[];
    agent: MemoryRecord[];
    global: MemoryRecord[];
  };
  ranked: MemoryRecord[];
} {
  const q = (input.userMessage ?? "").trim().toLowerCase();
  const scoreBoost = (row: MemoryRecord): number => {
    let score = row.score;
    if (row.status === "pinned") score += 0.2;
    if (q && row.text.toLowerCase().includes(q.slice(0, 24))) score += 0.15;
    return score;
  };

  const hierarchy = {
    temporary: [...input.temporary].sort((a, b) => scoreBoost(b) - scoreBoost(a)),
    contact: [...input.contact].sort((a, b) => scoreBoost(b) - scoreBoost(a)),
    agent: [...input.agent].sort((a, b) => scoreBoost(b) - scoreBoost(a)),
    global: [...input.global].sort((a, b) => scoreBoost(b) - scoreBoost(a)),
  };

  const ranked = [
    ...hierarchy.temporary,
    ...hierarchy.contact,
    ...hierarchy.agent,
    ...hierarchy.global,
  ].sort((a, b) => scoreBoost(b) - scoreBoost(a));

  return { hierarchy, ranked };
}

export function estimateMemoryTokens(records: MemoryRecord[]): number {
  const chars = records.reduce((sum, r) => sum + r.text.length, 0);
  return Math.ceil(chars / 4);
}

export function summarizeMemoryRecords(records: MemoryRecord[], maxItems = 12): string {
  if (records.length === 0) return "";
  const grouped = new Map<string, string[]>();
  for (const row of records.slice(0, maxItems)) {
    const key = row.category;
    const list = grouped.get(key) ?? [];
    list.push(row.text);
    grouped.set(key, list);
  }
  const lines: string[] = [];
  for (const [cat, texts] of grouped) {
    lines.push(`${cat.replace(/_/g, " ")}: ${texts.join("; ")}`);
  }
  return lines.join("\n");
}
