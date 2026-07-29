import { parseToolEilConfig } from "../eil/parseEilConfig.js";
import type { CapabilityNode, ToolEilConfig } from "../eil/types.js";
import { buildCapabilityGraph, findCapabilityNode } from "../eil/CapabilityGraph.js";

/**
 * Tool Registry — metadata declarativa por tool (capabilities, facts, timeout, retry).
 * Fonte: AutomationCustomTool.config.eil — sem hardcode de segmento.
 */
export type ToolRegistryEntry = {
  name: string;
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
  entries: ToolRegistryEntry[];
};

export function buildToolRegistry(
  tools: Array<{ name: string; config?: unknown }>,
): ToolRegistry {
  const entries: ToolRegistryEntry[] = [];
  const byName = new Map<string, ToolRegistryEntry>();
  for (const tool of tools) {
    const name = (tool.name ?? "").trim();
    if (!name) continue;
    const eil = parseToolEilConfig(tool.config);
    const entry: ToolRegistryEntry = {
      name,
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
    byName.set(name.toLowerCase(), entry);
  }
  return { byName, entries };
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
  return registry.byName.get(toolName.trim().toLowerCase());
}

export function findRegistryNode(
  registry: ToolRegistry,
  toolName: string,
): CapabilityNode | undefined {
  const graph = capabilityGraphFromRegistry(registry);
  return findCapabilityNode(graph, toolName);
}
