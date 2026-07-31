import { parseToolEilConfig } from "../eil/parseEilConfig.js";
import type { CapabilityNode, ToolEilConfig } from "../eil/types.js";
import { buildCapabilityGraph, findCapabilityNode } from "../eil/CapabilityGraph.js";

/**
 * Tool Registry — metadata declarativa por tool (capabilities, facts, timeout, retry).
 * Fonte: AutomationCustomTool.config.eil — sem hardcode de segmento.
 */
export type ToolRegistryEntry = {
  name: string;
  /** Nome OpenAI oc_tool_* quando diferente do name estável. */
  openAiName?: string;
  capabilities: string[];
  produces: string[];
  consumesFacts: string[];
  conflictsWith: string[];
  timeoutMs?: number;
  retryMax?: number;
  provider?: string;
  version?: string;
  eil: ToolEilConfig;
};

export type ToolRegistry = {
  byName: Map<string, ToolRegistryEntry>;
  /** oc_tool_<hex> ou openAiName → entry estável */
  byAlias: Map<string, ToolRegistryEntry>;
  entries: ToolRegistryEntry[];
};

function isOcToolName(name: string): boolean {
  return /^oc_tool_[a-f0-9]{32}$/i.test(name.trim());
}

export function buildToolRegistry(
  tools: Array<{ name: string; config?: unknown; openAiName?: string }>,
): ToolRegistry {
  const entries: ToolRegistryEntry[] = [];
  const byName = new Map<string, ToolRegistryEntry>();
  const byAlias = new Map<string, ToolRegistryEntry>();
  for (const tool of tools) {
    const name = (tool.name ?? "").trim();
    if (!name) continue;
    const eil = parseToolEilConfig(tool.config);
    const registryName =
      isOcToolName(name) && eil.stableName?.trim() ? eil.stableName.trim() : name;
    const openAiCandidate =
      (typeof tool.openAiName === "string" && tool.openAiName.trim()) ||
      (isOcToolName(name) ? name : undefined);
    const entry: ToolRegistryEntry = {
      name: registryName,
      openAiName:
        openAiCandidate && openAiCandidate.toLowerCase() !== registryName.toLowerCase()
          ? openAiCandidate
          : undefined,
      capabilities: eil.capabilities ?? [],
      produces: eil.produces ?? [],
      consumesFacts: eil.requiresFacts ?? [],
      conflictsWith: eil.conflictsWith ?? [],
      timeoutMs: eil.timeoutMs,
      retryMax: eil.retryMax,
      provider: eil.provider,
      version: eil.version,
      eil,
    };
    entries.push(entry);
    byName.set(registryName.toLowerCase(), entry);
    if (entry.openAiName) {
      byAlias.set(entry.openAiName.toLowerCase(), entry);
    }
    if (name.toLowerCase() !== registryName.toLowerCase()) {
      byAlias.set(name.toLowerCase(), entry);
    }
  }
  return { byName, byAlias, entries };
}

export function registryEntryToCapabilityNode(entry: ToolRegistryEntry): CapabilityNode {
  return {
    toolName: entry.name,
    capabilities: entry.capabilities,
    produces: entry.produces,
    requiresFacts: entry.consumesFacts,
    factPaths: entry.eil.factPaths ?? {},
    conflictsWith: entry.conflictsWith,
    timeoutMs: entry.timeoutMs,
    retryMax: entry.retryMax,
    provider: entry.provider,
    version: entry.version,
  };
}

/** Capability graph a partir do registry (mesma fonte de verdade). */
export function capabilityGraphFromRegistry(registry: ToolRegistry) {
  return buildCapabilityGraph({
    tools: registry.entries.map((e) => ({
      name: e.name,
      config: { eil: e.eil },
    })),
  });
}

export function getRegistryEntry(
  registry: ToolRegistry,
  toolName: string,
): ToolRegistryEntry | undefined {
  const key = toolName.trim().toLowerCase();
  return registry.byName.get(key) ?? registry.byAlias.get(key);
}

/** Resolve oc_tool_* → nome estável (audaar_*). Fallback: input original. */
export function resolveStableToolName(
  registry: ToolRegistry | null | undefined,
  toolName: string,
): string {
  const trimmed = toolName.trim();
  if (!registry) return trimmed;
  const entry = getRegistryEntry(registry, trimmed);
  return entry?.name ?? trimmed;
}

/** Lista de aliases conhecidos para uma tool (inclui oc_tool_*). */
export function toolRegistryAliases(
  registry: ToolRegistry,
  stableName: string,
): string[] {
  const entry = getRegistryEntry(registry, stableName);
  if (!entry) return [stableName];
  const aliases = new Set<string>([entry.name]);
  if (entry.openAiName) aliases.add(entry.openAiName);
  for (const [alias, e] of registry.byAlias) {
    if (e.name === entry.name) aliases.add(alias);
  }
  return [...aliases];
}

export function findRegistryNode(
  registry: ToolRegistry,
  toolName: string,
): CapabilityNode | undefined {
  const graph = capabilityGraphFromRegistry(registry);
  return findCapabilityNode(graph, toolName);
}
