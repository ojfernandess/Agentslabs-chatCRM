import { EIL_FACT_CATALOG, type EilFactDef, type EilFactType } from "./catalog.js";
import { extractToolEil } from "./toolConfig.js";

export type ResolvedFactEntry = EilFactDef & {
  jsonPath?: string;
  producedBy: string[];
  capabilities: string[];
  available: boolean;
};

export type ToolEilSource = {
  name: string;
  config?: Record<string, unknown> | null;
};

function inferFactType(key: string): EilFactType {
  const known = EIL_FACT_CATALOG.find((f) => f.key === key);
  if (known) return known.type;
  if (/Quantity|Count|Amount|Id$/i.test(key)) return "number";
  if (/found|enabled|active|is[A-Z]/i.test(key)) return "boolean";
  return "string";
}

function inferCategory(key: string): EilFactDef["category"] {
  const known = EIL_FACT_CATALOG.find((f) => f.key === key);
  if (known) return known.category;
  if (/guest|document|name|email|phone|cpf/i.test(key)) return "guest";
  if (/reservation|checkin|stay|guests/i.test(key)) return "reservation";
  if (/payment|invoice|pix/i.test(key)) return "payment";
  return "other";
}

/** Monta catálogo de facts a partir das ferramentas conectadas + catálogo base. */
export function buildFactCatalog(tools: ToolEilSource[], enabledToolNames?: Set<string>): ResolvedFactEntry[] {
  const map = new Map<string, ResolvedFactEntry>();

  for (const base of EIL_FACT_CATALOG) {
    map.set(base.key, { ...base, producedBy: [], capabilities: [], available: false });
  }

  for (const tool of tools) {
    if (enabledToolNames && !enabledToolNames.has(tool.name)) continue;
    const eil = extractToolEil(tool.config ?? null);
    if (!eil) continue;

    const caps = Array.isArray(eil.capabilities) ? eil.capabilities : [];
    const produces = Array.isArray(eil.produces) ? eil.produces : [];
    const paths = eil.factPaths && typeof eil.factPaths === "object" ? eil.factPaths : {};

    for (const factKey of produces) {
      const key = factKey.trim();
      if (!key) continue;
      const existing = map.get(key);
      const jsonPath = typeof paths[key] === "string" ? paths[key] : existing?.jsonPath;
      if (existing) {
        if (!existing.producedBy.includes(tool.name)) existing.producedBy.push(tool.name);
        existing.capabilities.push(...caps.filter((c) => !existing.capabilities.includes(c)));
        existing.available = true;
        if (jsonPath) existing.jsonPath = jsonPath;
      } else {
        map.set(key, {
          key,
          labelPt: key,
          labelEn: key,
          type: inferFactType(key),
          category: inferCategory(key),
          jsonPath,
          producedBy: [tool.name],
          capabilities: [...caps],
          available: true,
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => a.labelPt.localeCompare(b.labelPt, "pt"));
}

export function countPoliciesUsingAction(policies: Array<{ action?: string }>, actionId: string): number {
  return policies.filter((p) => p.action === actionId).length;
}

export function countPoliciesUsingFact(
  policies: Array<{ requires?: Array<{ fact: string }>; forbids?: Array<{ fact: string }> }>,
  factKey: string,
): number {
  let n = 0;
  for (const p of policies) {
    const preds = [...(p.requires ?? []), ...(p.forbids ?? [])];
    if (preds.some((x) => x.fact === factKey)) n++;
  }
  return n;
}
