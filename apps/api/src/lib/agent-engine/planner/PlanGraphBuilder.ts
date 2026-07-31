/**
 * Fase 3 — DAG de steps/tools a partir do Prompt IR + CapabilityGraph.
 */
import type { FlowDefinition } from "../contract/FlowDefinition.js";
import type { CapabilityGraph } from "../eil/types.js";
import type { FactStore } from "../eil/types.js";
import { hasFact } from "../eil/FactsEngine.js";

export type PlanGraphNodeKind = "flow_step" | "tool" | "fact";

export type PlanGraphNode = {
  id: string;
  kind: PlanGraphNodeKind;
  label: string;
  toolName?: string;
  dependsOn: string[];
};

export type PlanGraph = {
  nodes: PlanGraphNode[];
  /** Tools na ordem sugerida (deps → dependents). */
  orderedToolNames: string[];
};

export type BuildPlanGraphOpts = {
  flows: FlowDefinition[];
  requiredToolNames: string[];
  graph: CapabilityGraph;
  facts: FactStore;
  toolsCalled?: string[];
};

function toolNodeId(name: string): string {
  return `tool:${name.toLowerCase()}`;
}

/** Ordenação topológica simples por dependsOn. */
function topologicalToolOrder(nodes: PlanGraphNode[], required: string[]): string[] {
  const toolNodes = nodes.filter((n) => n.kind === "tool" && n.toolName);
  const idToNode = new Map(toolNodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = idToNode.get(id);
    if (!node?.toolName) return;
    for (const dep of node.dependsOn) visit(dep);
    order.push(node.toolName);
  };

  for (const name of required) {
    visit(toolNodeId(name));
  }
  return [...new Set(order.map((n) => n.toLowerCase()))].map(
    (lower) => required.find((r) => r.toLowerCase() === lower) ?? lower,
  );
}

export function buildPlanGraph(opts: BuildPlanGraphOpts): PlanGraph {
  const nodes: PlanGraphNode[] = [];
  const called = new Set((opts.toolsCalled ?? []).map((t) => t.toLowerCase()));

  for (const flow of opts.flows) {
    for (const step of flow.steps) {
      nodes.push({
        id: step.id,
        kind: "flow_step",
        label: step.label,
        toolName: step.toolNames[0],
        dependsOn: [],
      });
    }
  }

  for (const toolName of opts.requiredToolNames) {
    const cap = opts.graph.nodes.find((n) => n.toolName.toLowerCase() === toolName.toLowerCase());
    const factDeps: string[] = [];
    for (const fact of cap?.requiresFacts ?? []) {
      if (!hasFact(opts.facts, fact)) {
        factDeps.push(`fact:${fact}`);
        nodes.push({
          id: `fact:${fact}`,
          kind: "fact",
          label: fact,
          dependsOn: [],
        });
      }
    }
    const producerDeps = (cap?.requiresFacts ?? [])
      .flatMap((f) => opts.graph.producersByFact[f] ?? [])
      .filter((producer) => producer.toLowerCase() !== toolName.toLowerCase())
      .filter((producer) => !called.has(producer.toLowerCase()))
      .map((p) => toolNodeId(p));

    nodes.push({
      id: toolNodeId(toolName),
      kind: "tool",
      label: toolName,
      toolName,
      dependsOn: [...new Set([...factDeps, ...producerDeps])],
    });
  }

  const orderedToolNames = topologicalToolOrder(nodes, opts.requiredToolNames);
  return { nodes, orderedToolNames };
}

/** Step activo no flow — primeiro step cujas tools ainda não foram satisfeitas. */
export function resolveActiveFlowStep(
  flows: FlowDefinition[],
  toolsCalled: string[],
): { flowId: string; stepId: string; label: string } | null {
  const called = new Set(toolsCalled.map((t) => t.toLowerCase()));
  for (const flow of flows) {
    for (const step of flow.steps) {
      const pending = step.toolNames.some((t) => !called.has(t.toLowerCase()));
      if (pending && step.toolNames.length > 0) {
        return { flowId: flow.id, stepId: step.id, label: step.label };
      }
    }
  }
  return null;
}
