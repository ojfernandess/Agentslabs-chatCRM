/** Lógica partilhada: A/B, script, export (Fase 3). */

export interface ChatbotAbVariant {
  id: string;
  weight: number;
}

export function parseAbVariants(raw: unknown): ChatbotAbVariant[] {
  if (!Array.isArray(raw)) return [{ id: "a", weight: 50 }, { id: "b", weight: 50 }];
  const parsed = raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
    .map((x, i) => ({
      id: typeof x.id === "string" && x.id.trim() ? x.id.trim() : String.fromCharCode(97 + i),
      weight: Math.max(0, Number(x.weight ?? x.percent ?? 50) || 0),
    }))
    .filter((v) => v.id);
  return parsed.length ? parsed : [{ id: "a", weight: 50 }, { id: "b", weight: 50 }];
}

/** Escolha ponderada; `seed` fixo reproduz o mesmo ramo (ex.: contactId + nodeId). */
export function pickAbTestVariant(variants: ChatbotAbVariant[], seed?: string): string {
  const list = variants.filter((v) => v.weight > 0);
  if (!list.length) return variants[0]?.id ?? "a";
  const total = list.reduce((s, v) => s + v.weight, 0);
  let r: number;
  if (seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    r = (h % 10_000) / 10_000;
  } else {
    r = Math.random();
  }
  let acc = 0;
  const threshold = r * (total > 0 ? total : 1);
  for (const v of list) {
    acc += v.weight;
    if (threshold < acc) return v.id;
  }
  return list[list.length - 1]!.id;
}

/** Linhas `nome = valor` com templates {{var}} já substituídos no valor. */
export function applyChatbotScriptAssignments(
  code: string,
  vars: Record<string, string>,
  substitute: (fragment: string) => string,
): Record<string, string> {
  const out = { ...vars };
  for (const line of code.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    const rawValue = trimmed.slice(eq + 1).trim();
    out[name] = substitute(rawValue);
  }
  return out;
}

export const CHATBOT_FLOW_EXPORT_VERSION = 1;

export interface ChatbotFlowExportBundle {
  version: number;
  exportedAt: string;
  flow: {
    name: string;
    description?: string | null;
    flowDefinition: unknown;
    variables?: unknown;
    theme?: unknown;
    settings?: unknown;
  };
}

export function buildChatbotFlowExportBundle(input: {
  name: string;
  description?: string | null;
  flowDefinition: unknown;
  variables?: unknown;
  theme?: unknown;
  settings?: unknown;
}): ChatbotFlowExportBundle {
  return {
    version: CHATBOT_FLOW_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    flow: {
      name: input.name,
      description: input.description ?? null,
      flowDefinition: input.flowDefinition,
      variables: input.variables ?? [],
      theme: input.theme ?? null,
      settings: input.settings ?? null,
    },
  };
}
