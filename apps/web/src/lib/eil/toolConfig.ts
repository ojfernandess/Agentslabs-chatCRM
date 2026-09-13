export type ToolEilConfigDraft = {
  produces?: string[];
  requiresFacts?: string[];
  capabilities?: string[];
  factPaths?: Record<string, string>;
};

export type ParsedToolEilResult =
  | { ok: true; value: ToolEilConfigDraft; summary: { produces: number; capabilities: number; requiresFacts: number; factPaths: number } }
  | { ok: false; error: string };

export function extractToolEil(config: Record<string, unknown> | undefined | null): ToolEilConfigDraft | null {
  if (!config || typeof config !== "object") return null;
  const raw = config.eil;
  if (!raw || typeof raw !== "object") return null;
  return raw as ToolEilConfigDraft;
}

export function toolHasEilConfig(config: Record<string, unknown> | undefined | null): boolean {
  const eil = extractToolEil(config);
  if (!eil) return false;
  const produces = Array.isArray(eil.produces) ? eil.produces.length : 0;
  const caps = Array.isArray(eil.capabilities) ? eil.capabilities.length : 0;
  const req = Array.isArray(eil.requiresFacts) ? eil.requiresFacts.length : 0;
  const paths = eil.factPaths && typeof eil.factPaths === "object" ? Object.keys(eil.factPaths).length : 0;
  return produces + caps + req + paths > 0;
}

/** Valida e normaliza o JSON de `config.eil`. */
export function parseToolEilJson(raw: string): ParsedToolEilResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: "json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "object" };
  }
  const obj = parsed as Record<string, unknown>;
  const out: ToolEilConfigDraft = {};

  if (obj.produces !== undefined) {
    if (!Array.isArray(obj.produces) || !obj.produces.every((x) => typeof x === "string")) {
      return { ok: false, error: "produces" };
    }
    out.produces = obj.produces.map((x) => x.trim()).filter(Boolean);
  }
  if (obj.requiresFacts !== undefined) {
    if (!Array.isArray(obj.requiresFacts) || !obj.requiresFacts.every((x) => typeof x === "string")) {
      return { ok: false, error: "requiresFacts" };
    }
    out.requiresFacts = obj.requiresFacts.map((x) => x.trim()).filter(Boolean);
  }
  if (obj.capabilities !== undefined) {
    if (!Array.isArray(obj.capabilities) || !obj.capabilities.every((x) => typeof x === "string")) {
      return { ok: false, error: "capabilities" };
    }
    out.capabilities = obj.capabilities.map((x) => x.trim()).filter(Boolean);
  }
  if (obj.factPaths !== undefined) {
    if (!obj.factPaths || typeof obj.factPaths !== "object" || Array.isArray(obj.factPaths)) {
      return { ok: false, error: "factPaths" };
    }
    const factPaths: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.factPaths as Record<string, unknown>)) {
      if (typeof v !== "string") return { ok: false, error: "factPaths" };
      const key = k.trim();
      const path = v.trim();
      if (key && path) factPaths[key] = path;
    }
    out.factPaths = factPaths;
  }

  return {
    ok: true,
    value: out,
    summary: {
      produces: out.produces?.length ?? 0,
      capabilities: out.capabilities?.length ?? 0,
      requiresFacts: out.requiresFacts?.length ?? 0,
      factPaths: out.factPaths ? Object.keys(out.factPaths).length : 0,
    },
  };
}
