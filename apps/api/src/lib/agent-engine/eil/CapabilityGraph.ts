import { parseToolEilConfig } from "./parseEilConfig.js";
import type { CapabilityGraph, CapabilityNode } from "./types.js";

export type BuildCapabilityGraphInput = {
  tools: Array<{ name: string; config?: unknown }>;
};

/**
 * Capability Graph — cada tool declara o que produz / requer / capabilities.
 * Sem whitelist de domínio: metadata vem de config.eil.
 */
export function buildCapabilityGraph(input: BuildCapabilityGraphInput): CapabilityGraph {
  const nodes: CapabilityNode[] = [];
  const producersByFact: Record<string, string[]> = {};
  const toolsByCapability: Record<string, string[]> = {};

  for (const tool of input.tools) {
    const name = (tool.name ?? "").trim();
    if (!name) continue;
    const eil = parseToolEilConfig(tool.config);
    const node: CapabilityNode = {
      toolName: name,
      capabilities: eil.capabilities ?? [],
      produces: eil.produces ?? [],
      requiresFacts: eil.requiresFacts ?? [],
      factPaths: eil.factPaths ?? {},
    };
    nodes.push(node);

    for (const fact of node.produces) {
      if (!producersByFact[fact]) producersByFact[fact] = [];
      if (!producersByFact[fact].includes(name)) producersByFact[fact].push(name);
    }
    for (const cap of node.capabilities) {
      if (!toolsByCapability[cap]) toolsByCapability[cap] = [];
      if (!toolsByCapability[cap].includes(name)) toolsByCapability[cap].push(name);
    }
  }

  return { nodes, producersByFact, toolsByCapability };
}

export function findCapabilityNode(
  graph: CapabilityGraph,
  toolName: string,
): CapabilityNode | undefined {
  const needle = toolName.trim().toLowerCase();
  return graph.nodes.find((n) => n.toolName.toLowerCase() === needle);
}
