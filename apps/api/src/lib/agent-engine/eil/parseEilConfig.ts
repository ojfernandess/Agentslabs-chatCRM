import type { EilBehaviorConfig, ToolEilConfig } from "./types.js";

/** Lê `behaviorConfig.eil` — sem domain knowledge. */
export function parseEilBehaviorConfig(
  behaviorConfig: Record<string, unknown> | null | undefined,
): EilBehaviorConfig | null {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return null;
  const raw = behaviorConfig.eil;
  if (!raw || typeof raw !== "object") return null;
  const eil = raw as Record<string, unknown>;
  const policies = Array.isArray(eil.policies) ? eil.policies : [];
  return {
    enabled: eil.enabled !== false,
    policies: policies.filter(
      (p): p is NonNullable<EilBehaviorConfig["policies"]>[number] =>
        !!p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string",
    ) as EilBehaviorConfig["policies"],
  };
}

/** EIL activo quando o bloco existe e enabled !== false. */
export function isEilEnabled(behaviorConfig: Record<string, unknown> | null | undefined): boolean {
  const cfg = parseEilBehaviorConfig(behaviorConfig);
  return cfg != null && cfg.enabled !== false;
}

/** Extrai `config.eil` de um tool row. */
export function parseToolEilConfig(config: unknown): ToolEilConfig {
  if (!config || typeof config !== "object") return {};
  const root = config as Record<string, unknown>;
  const eil = root.eil;
  if (!eil || typeof eil !== "object") return {};
  const e = eil as Record<string, unknown>;
  const produces = Array.isArray(e.produces)
    ? e.produces.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const requiresFacts = Array.isArray(e.requiresFacts)
    ? e.requiresFacts.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const capabilities = Array.isArray(e.capabilities)
    ? e.capabilities.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const factPaths: Record<string, string> = {};
  if (e.factPaths && typeof e.factPaths === "object") {
    for (const [k, v] of Object.entries(e.factPaths as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) factPaths[k] = v.trim();
    }
  }
  return { produces, requiresFacts, capabilities, factPaths };
}
