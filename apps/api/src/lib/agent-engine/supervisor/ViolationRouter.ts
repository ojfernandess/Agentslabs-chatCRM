import type { ExecutionContract } from "../core/types.js";
import type { ConstraintViolation } from "../eil/types.js";

/** Camada upstream responsável pela correção (RCA). */
export type ViolationLayer =
  | "compiler"
  | "planner"
  | "policy"
  | "scheduler"
  | "runtime"
  | "llm"
  | "supervisor"
  | "unknown";

export type RoutedViolation = {
  id: string;
  message: string;
  layer: ViolationLayer;
  component: string;
  rcaHint: string;
};

const SUPERVISOR_CHECK_LAYERS: Record<string, ViolationLayer> = {
  execution_contract_valid: "planner",
  required_tools_contract: "scheduler",
  forbidden_tools_contract: "policy",
  eil_plan_followed: "planner",
  eil_required_facts: "runtime",
  eil_constraints: "policy",
  eil_forbidden_action: "policy",
  completion_claim_without_tool: "llm",
  completion_reply: "llm",
  validation_passed: "runtime",
  knowledge_used: "llm",
  tools_not_ignored: "scheduler",
};

/** Aponta falha de check do supervisor para a camada upstream. */
export function routeSupervisorCheckFailure(checkId: string, detail?: string): RoutedViolation {
  const layer = SUPERVISOR_CHECK_LAYERS[checkId] ?? "unknown";
  return {
    id: `supervisor:${checkId}`,
    message: detail ?? `Supervisor check failed: ${checkId}`,
    layer,
    component: componentForLayer(layer),
    rcaHint: rcaHintForLayer(layer, checkId),
  };
}

function componentForLayer(layer: ViolationLayer): string {
  switch (layer) {
    case "compiler":
      return "PromptCompiler";
    case "planner":
      return "UnifiedExecutionPlanner";
    case "policy":
      return "PolicyEngine";
    case "scheduler":
      return "TurnToolScheduler";
    case "runtime":
      return "ExecutionEngine";
    case "llm":
      return "LlmTurnAdapter";
    case "supervisor":
      return "AgentSupervisorService";
    default:
      return "unknown";
  }
}

function rcaHintForLayer(layer: ViolationLayer, checkId: string): string {
  switch (layer) {
    case "planner":
      return "Verificar Prompt IR → plano (required tools / facts pendentes)";
    case "policy":
      return "Verificar PolicyRule[] do IR e constraints EIL";
    case "scheduler":
      return "Verificar planScheduledToolInvocations e canInvokeTool";
    case "runtime":
      return "Verificar invoke path, facts ingest, ToolValidator mid-turn";
    case "llm":
      return `Verificar resposta LLM — check ${checkId} (sem fallback no supervisor)`;
    case "compiler":
      return "Verificar compilePromptToIR / promptContract";
    default:
      return "Investigar trace completo e PATCH-REGISTRY";
  }
}

/** Deriva violações roteadas a partir do ExecutionContract. */
export function routeViolationsFromContract(contract: ExecutionContract): RoutedViolation[] {
  const routed: RoutedViolation[] = [];
  for (const v of contract.violations) {
    if (v.startsWith("required_tool_missing:")) {
      routed.push({
        id: v,
        message: v,
        layer: "scheduler",
        component: "TurnToolScheduler",
        rcaHint: "Tool obrigatória não executada — verificar scheduler e plano",
      });
    } else if (v.startsWith("forbidden_tool_used:")) {
      routed.push({
        id: v,
        message: v,
        layer: "policy",
        component: "PolicyEngine",
        rcaHint: "Par proibido ou tool fora do plano — verificar turnPolicy / IR policies",
      });
    } else if (v.startsWith("fact_missing:")) {
      routed.push({
        id: v,
        message: v,
        layer: "runtime",
        component: "FactsEngine",
        rcaHint: "Facto em falta — verificar ordem de tools produtoras",
      });
    } else {
      routed.push({
        id: v,
        message: v,
        layer: "planner",
        component: "UnifiedExecutionPlanner",
        rcaHint: "Violação de contrato — verificar plano unificado",
      });
    }
  }
  if (!contract.valid && contract.violations.length === 0) {
    routed.push({
      id: "contract_invalid",
      message: "ExecutionContract inválido",
      layer: "planner",
      component: "buildTurnContext",
      rcaHint: "Contrato inválido sem violações explícitas — inspecionar buildTurnContext",
    });
  }
  return routed;
}

export function routeEilViolations(violations: ConstraintViolation[]): RoutedViolation[] {
  return violations.map((v) => ({
    id: `eil:${v.policyId}`,
    message: v.reason,
    layer: "policy",
    component: "PolicyEngine",
    rcaHint: `Policy ${v.policyId} — acção ${v.action ?? "n/a"}`,
  }));
}

/** Consolida roteamento para trace MCP / RCA. */
export function routeStructuralViolations(opts: {
  executionContract?: ExecutionContract | null;
  eilViolations?: ConstraintViolation[];
  failedCheckIds?: Array<{ id: string; detail?: string }>;
}): RoutedViolation[] {
  const out: RoutedViolation[] = [];
  if (opts.executionContract) {
    out.push(...routeViolationsFromContract(opts.executionContract));
  }
  if (opts.eilViolations?.length) {
    out.push(...routeEilViolations(opts.eilViolations));
  }
  for (const c of opts.failedCheckIds ?? []) {
    out.push(routeSupervisorCheckFailure(c.id, c.detail));
  }
  const seen = new Set<string>();
  return out.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}
