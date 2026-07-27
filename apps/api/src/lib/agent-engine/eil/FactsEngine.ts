import { findCapabilityNode } from "./CapabilityGraph.js";
import type {
  CapabilityGraph,
  FactStore,
  FactValue,
  ToolOutcomeForEil,
} from "./types.js";

const AUTO_DISCOVER_KEY =
  /^(id|.*[Ii]d|.*[Ss]tatus|.*[Qq]uantity|.*[Cc]ount|.*[Dd]ate|.*[Aa]mount|.*[Cc]ode|.*[Rr]eference|token|localizador|email|phone|documento|documentNumber)$/;

function isScalar(v: unknown): v is FactValue {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

/** Resolve caminho simples "a.b.c" no objecto. */
export function getPathValue(root: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function tryParseJson(preview: string | undefined): unknown {
  if (!preview || typeof preview !== "string") return undefined;
  const t = preview.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function unwrapPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  // Common wrappers: { data: {...} }, { result: {...} }, { body: {...} }
  for (const wrap of ["data", "result", "body", "payload", "response"]) {
    const inner = obj[wrap];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return { ...obj, ...(inner as Record<string, unknown>) };
    }
  }
  return obj;
}

function autoDiscoverFacts(
  payload: Record<string, unknown>,
  source: string,
  now: string,
  depth = 0,
  prefix = "",
): FactStore {
  const out: FactStore = {};
  if (depth > 3) return out;
  for (const [key, value] of Object.entries(payload)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isScalar(value) && AUTO_DISCOVER_KEY.test(key)) {
      out[key] = { key, value, source, updatedAt: now };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && depth < 2) {
      const nested = autoDiscoverFacts(
        value as Record<string, unknown>,
        source,
        now,
        depth + 1,
        fullKey,
      );
      // Prefer leaf keys without prefix collision (leaf key wins if unique)
      for (const [nk, nf] of Object.entries(nested)) {
        if (!out[nk]) out[nk] = nf;
      }
    }
  }
  return out;
}

/**
 * Extrai facts de um resultado de tool via produces/factPaths ou auto-descoberta.
 */
export function extractFactsFromToolResult(opts: {
  toolName: string;
  ok: boolean;
  structuredPayload?: unknown;
  preview?: string;
  graph?: CapabilityGraph;
}): FactStore {
  if (!opts.ok) return {};
  const now = new Date().toISOString();
  const payload =
    opts.structuredPayload ?? tryParseJson(opts.preview);
  const root = unwrapPayload(payload);
  if (!root) return {};

  const node = opts.graph ? findCapabilityNode(opts.graph, opts.toolName) : undefined;
  const out: FactStore = {};

  if (node && (node.produces.length > 0 || Object.keys(node.factPaths).length > 0)) {
    const keys = new Set([...node.produces, ...Object.keys(node.factPaths)]);
    for (const key of keys) {
      const path = node.factPaths[key] ?? key;
      let raw = getPathValue(root, path);
      if (raw === undefined && path.includes(".")) {
        // also try leaf key at top-level after unwrap
        raw = root[key];
      }
      if (raw === undefined) {
        // search one level deep for leaf key
        for (const v of Object.values(root)) {
          if (v && typeof v === "object" && !Array.isArray(v) && key in (v as object)) {
            raw = (v as Record<string, unknown>)[key];
            break;
          }
        }
      }
      if (isScalar(raw)) {
        out[key] = { key, value: raw, source: opts.toolName, updatedAt: now };
      }
    }
    return out;
  }

  return autoDiscoverFacts(root, opts.toolName, now);
}

export function factsFromFlowSlots(
  flowSlots: Record<string, string | number | boolean> | undefined,
  source = "flowSlots",
): FactStore {
  if (!flowSlots) return {};
  const now = new Date().toISOString();
  const out: FactStore = {};
  for (const [key, value] of Object.entries(flowSlots)) {
    if (value === undefined) continue;
    out[key] = { key, value, source, updatedAt: now };
  }
  return out;
}

export function mergeFactStores(...stores: FactStore[]): FactStore {
  const out: FactStore = {};
  for (const store of stores) {
    for (const [k, fact] of Object.entries(store)) {
      out[k] = fact;
    }
  }
  return out;
}

export function ingestToolOutcomes(opts: {
  outcomes: ToolOutcomeForEil[];
  prior?: FactStore;
  graph?: CapabilityGraph;
}): FactStore {
  let store = { ...(opts.prior ?? {}) };
  for (const o of opts.outcomes) {
    const extracted = extractFactsFromToolResult({
      toolName: o.name,
      ok: o.ok,
      structuredPayload: o.structuredPayload,
      preview: o.preview,
      graph: opts.graph,
    });
    store = mergeFactStores(store, extracted);
  }
  return store;
}

/** Espelha facts escalares para flowSlots (compat memória / HTTP fill). */
export function factsToFlowSlots(store: FactStore): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, f] of Object.entries(store)) {
    if (f.value === null) continue;
    out[k] = f.value;
  }
  return out;
}

export function factValuesMap(store: FactStore): Record<string, FactValue> {
  const out: Record<string, FactValue> = {};
  for (const [k, f] of Object.entries(store)) {
    out[k] = f.value;
  }
  return out;
}

export function hasFact(store: FactStore, key: string): boolean {
  return key in store && store[key]?.value !== undefined && store[key]?.value !== null;
}
