import { parseToolEilConfig } from "./parseEilConfig.js";
import { hasFact } from "./FactsEngine.js";
import type { CapabilityGraph, CapabilityNode, FactStore } from "./types.js";

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
      conflictsWith: eil.conflictsWith ?? [],
      timeoutMs: eil.timeoutMs,
      retryMax: eil.retryMax,
      provider: eil.provider,
      version: eil.version,
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

/** Factos declarados em requiresFacts ainda em falta no store. */
export function toolRequiresUnmetFacts(
  node: CapabilityNode | undefined,
  facts: FactStore,
): string[] {
  if (!node?.requiresFacts.length) return [];
  return node.requiresFacts.filter((f) => !hasFact(facts, f));
}

/**
 * Pode invocar a tool agora? false se requiresFacts em falta.
 * (Pares incompatíveis / exclusive ficam na TurnPolicy.)
 */
export function canInvokeTool(
  graph: CapabilityGraph,
  toolName: string,
  facts: FactStore,
): { ok: boolean; unmetFacts: string[] } {
  const node = findCapabilityNode(graph, toolName);
  const unmetFacts = toolRequiresUnmetFacts(node, facts);
  return { ok: unmetFacts.length === 0, unmetFacts };
}

/**
 * Ordena tools: produtores de factos em falta primeiro, depois o resto (estável).
 * Usado pelo Scheduler para não correr dependents antes dos producers.
 */
export function orderToolsByFactDeps(
  graph: CapabilityGraph,
  toolNames: string[],
  facts: FactStore,
): string[] {
  if (toolNames.length <= 1) return [...toolNames];

  const pendingFactNeeds = new Set<string>();
  for (const name of toolNames) {
    const node = findCapabilityNode(graph, name);
    for (const f of toolRequiresUnmetFacts(node, facts)) pendingFactNeeds.add(f);
  }

  const producersNeeded = new Set<string>();
  for (const fact of pendingFactNeeds) {
    for (const producer of graph.producersByFact[fact] ?? []) {
      producersNeeded.add(producer.toLowerCase());
    }
  }

  const producers: string[] = [];
  const rest: string[] = [];
  for (const name of toolNames) {
    if (producersNeeded.has(name.trim().toLowerCase())) producers.push(name);
    else rest.push(name);
  }
  // Producers that are also in the pending list come first; then dependents.
  return [...producers, ...rest.filter((n) => !producers.includes(n))];
}

/**
 * Motivo de bloqueio pré-execução por Capability Graph (requiresFacts / conflictsWith).
 * null = permitido.
 */
export function capabilityPreExecBlockReason(
  toolName: string,
  graph: CapabilityGraph | null | undefined,
  facts: FactStore | null | undefined,
  alreadyCalledThisTurn: string[] = [],
): string | null {
  if (!graph) return null;
  const store = facts ?? {};
  const node = findCapabilityNode(graph, toolName);
  if (!node) return null;

  const unmet = toolRequiresUnmetFacts(node, store);
  if (unmet.length > 0) {
    return `Capability Graph: factos em falta para \`${toolName}\`: ${unmet.join(", ")}. Execute primeiro a tool produtora.`;
  }

  if (node.conflictsWith.length > 0 && alreadyCalledThisTurn.length > 0) {
    const called = new Set(alreadyCalledThisTurn.map((n) => n.trim().toLowerCase()));
    for (const c of node.conflictsWith) {
      if (called.has(c)) {
        return `Capability Graph: \`${toolName}\` conflita com \`${c}\` no mesmo turno.`;
      }
    }
    // Symmetric: if an already-called tool declares conflict with this one
    for (const other of alreadyCalledThisTurn) {
      const otherNode = findCapabilityNode(graph, other);
      if (otherNode?.conflictsWith.some((x) => x === toolName.trim().toLowerCase())) {
        return `Capability Graph: \`${other}\` conflita com \`${toolName}\` no mesmo turno.`;
      }
    }
  }

  return null;
}

/** Detecta violação de ordem: dependent correu sem producer de requiresFacts satisfeito. */
export function detectToolOrderViolations(
  graph: CapabilityGraph,
  toolOutcomes: Array<{ name: string; ok?: boolean }>,
  factsBeforeTurn: FactStore,
): string[] {
  const alerts: string[] = [];
  const facts = { ...factsBeforeTurn };
  // Simulate chronological: we only know order in outcomes array
  for (const outcome of toolOutcomes) {
    if (outcome.ok === false) continue;
    const node = findCapabilityNode(graph, outcome.name);
    const unmet = toolRequiresUnmetFacts(node, facts);
    if (unmet.length > 0) {
      alerts.push(
        `Ordem de tools inválida: \`${outcome.name}\` exigia factos [${unmet.join(", ")}] ainda em falta`,
      );
    }
    // After successful call, mark produces as present (best-effort for order check)
    if (node) {
      for (const p of node.produces) {
        if (!hasFact(facts, p)) {
          facts[p] = { key: p, value: true, source: outcome.name };
        }
      }
    }
  }
  return alerts;
}
