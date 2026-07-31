import { componentById, componentsForFilePath, OPENNEXO_RUNTIME_COMPONENTS } from "./componentRegistry.js";
import type { ImpactAnalysisResult } from "./types.js";

export function analyzeArchitectureImpact(changedFiles: string[]): ImpactAnalysisResult {
  const affected = new Map<string, (typeof OPENNEXO_RUNTIME_COMPONENTS)[number]>();
  for (const f of changedFiles) {
    for (const c of componentsForFilePath(f)) {
      affected.set(c.id, c);
    }
  }

  const affectedComponents = [...affected.values()].map((c) => c.name);
  const dependencies = new Set<string>();
  const couplings = new Set<string>();

  for (const c of affected.values()) {
    for (const dep of c.dependsOn) {
      const comp = componentById(dep);
      if (comp) dependencies.add(comp.name);
      if (affected.has(dep)) couplings.add(`${c.name} ↔ ${comp?.name ?? dep}`);
    }
  }

  const ids = new Set([...affected.keys()]);
  const agentImpact: string[] = [];
  const workflowImpact: string[] = [];
  const toolImpact: string[] = [];
  const memoryImpact: string[] = [];
  const schedulerImpact: string[] = [];
  const plannerImpact: string[] = [];
  const runtimeImpact: string[] = [];

  if (ids.has("runtime") || ids.has("reply-synthesizer") || ids.has("resilience")) {
    agentImpact.push("Respostas e fluxo conversacional de agentes");
    runtimeImpact.push("Pipeline nativo agentNativeLlm");
  }
  if (ids.has("scheduler") || ids.has("planner")) {
    schedulerImpact.push("Pré-execução e ordem de tools por turno");
    plannerImpact.push("Contrato de execução e tools pendentes");
    workflowImpact.push("Fases S9/S10 e gates de confirmação");
  }
  if (ids.has("tool-runtime") || ids.has("checkin-embratur")) {
    toolImpact.push("Payload HTTP, schema validation e check-in");
  }
  if (ids.has("memory")) memoryImpact.push("Persistência de preferências e contexto");
  if (ids.has("capability-graph") || ids.has("facts-engine")) {
    workflowImpact.push("EIL — facts e pré-condições de invocação");
  }
  if (ids.has("supervisor") || ids.has("workflow-validator")) {
    agentImpact.push("Validação supervisor e anti-alucinação");
  }
  if (ids.has("mcp") || ids.has("architecture-governance")) {
    agentImpact.push("Observabilidade MCP para operadores");
  }

  const possibleRegressions: string[] = [];
  if (ids.has("scheduler") && ids.has("runtime")) {
    possibleRegressions.push("Conflito Scheduler vs invocação LLM (modo hybrid)");
  }
  if (ids.has("checkin-embratur")) {
    possibleRegressions.push("Check-in bloqueado ou payload Embratur incompleto");
  }
  if (ids.has("tool-runtime")) {
    possibleRegressions.push("Falso positivo/negativo em ok de tools HTTP");
  }

  const severity =
    affected.size >= 4 || ids.has("runtime")
      ? "critical"
      : affected.size >= 2
        ? "high"
        : affected.size === 1
          ? "medium"
          : "low";

  return {
    changedFiles,
    affectedComponents,
    dependencies: [...dependencies],
    couplings: [...couplings],
    possibleRegressions,
    agentImpact,
    workflowImpact,
    toolImpact,
    memoryImpact,
    schedulerImpact,
    plannerImpact,
    runtimeImpact,
    severity,
    requiresArchitecturalReview: severity === "critical" || severity === "high",
  };
}
