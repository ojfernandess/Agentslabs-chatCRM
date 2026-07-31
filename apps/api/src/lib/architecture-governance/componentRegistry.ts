/**
 * Registo de componentes do OpenNexo AI Runtime — usado para impact analysis.
 */

export type RuntimeComponent = {
  id: string;
  name: string;
  pathPatterns: RegExp[];
  dependsOn: string[];
  description: string;
};

export const OPENNEXO_RUNTIME_COMPONENTS: RuntimeComponent[] = [
  {
    id: "runtime",
    name: "OpenNexo / LangGraph Runtime",
    pathPatterns: [/agentNativeLlm\.ts$/, /agent-engine\/runtime\//],
    dependsOn: ["scheduler", "planner", "supervisor", "memory", "tool-runtime"],
    description: "Orquestração de turnos, LLM e tools.",
  },
  {
    id: "scheduler",
    name: "Tool Scheduler",
    pathPatterns: [/agent-engine\/scheduler\//],
    dependsOn: ["capability-graph", "facts-engine", "tool-runtime"],
    description: "Pré-execução determinística de tools obrigatórias.",
  },
  {
    id: "planner",
    name: "Execution Planner",
    pathPatterns: [/agent-engine\/planner\//, /agent-engine\/engine\/ExecutionEngine/],
    dependsOn: ["capability-graph", "facts-engine", "prompt-compiler"],
    description: "Plano de turno e contrato de execução.",
  },
  {
    id: "prompt-compiler",
    name: "Prompt Compiler",
    pathPatterns: [/agent-engine\/compiler\//, /agent-engine\/contract\//],
    dependsOn: [],
    description: "Compilação de prompts → Prompt IR e políticas de turno.",
  },
  {
    id: "capability-graph",
    name: "Capability Graph (EIL)",
    pathPatterns: [/agent-engine\/eil\/CapabilityGraph/],
    dependsOn: ["facts-engine"],
    description: "Grafo de capacidades e pré-condições de tools.",
  },
  {
    id: "facts-engine",
    name: "Facts Engine (EIL)",
    pathPatterns: [/agent-engine\/eil\/FactsEngine/],
    dependsOn: [],
    description: "Fact store por turno e sessão.",
  },
  {
    id: "supervisor",
    name: "Agent Supervisor",
    pathPatterns: [/agent-engine\/supervisor\//],
    dependsOn: ["workflow-validator"],
    description: "Validação estrutural e anti-alucinação.",
  },
  {
    id: "workflow-validator",
    name: "Workflow Validator",
    pathPatterns: [/agent-engine\/audit\/WorkflowValidator/],
    dependsOn: ["planner"],
    description: "Validação de fluxo multi-turno.",
  },
  {
    id: "memory",
    name: "Memory Manager",
    pathPatterns: [/agent-engine\/memory\//],
    dependsOn: [],
    description: "Memória de sessão e preferências.",
  },
  {
    id: "tool-runtime",
    name: "Tool Runtime (HTTP)",
    pathPatterns: [/automationHttpToolExecute\.ts$/, /invokeScheduledTools/],
    dependsOn: [],
    description: "Execução HTTP de ferramentas e validação de schema.",
  },
  {
    id: "checkin-embratur",
    name: "Embratur / Check-in Domain",
    pathPatterns: [/agent-engine\/checkin\//],
    dependsOn: ["tool-runtime", "scheduler", "runtime"],
    description: "Resolução FNRH e guardas de check-in.",
  },
  {
    id: "resilience",
    name: "Turn Resilience",
    pathPatterns: [/agent-engine\/resilience\//],
    dependsOn: ["runtime", "supervisor"],
    description: "Recuperação e entrega forçada de resultados.",
  },
  {
    id: "reply-synthesizer",
    name: "Reply Synthesizer",
    pathPatterns: [/agent-engine\/reply\//],
    dependsOn: ["runtime"],
    description: "Scripts fixos e síntese de resposta.",
  },
  {
    id: "mcp",
    name: "OpenNexo MCP",
    pathPatterns: [/lib\/mcp\//],
    dependsOn: [],
    description: "Inspeção e auditoria via MCP.",
  },
  {
    id: "architecture-governance",
    name: "Architecture Governance (AGS)",
    pathPatterns: [/architecture-governance\//, /docs\/architecture\//],
    dependsOn: ["mcp"],
    description: "ADR, RCA, quality gates e impact analysis.",
  },
  {
    id: "observability",
    name: "Observabilidade / Langfuse",
    pathPatterns: [/agent-engine\/observability\//, /mcp-langfuse/],
    dependsOn: ["runtime"],
    description: "Traces, métricas e export Langfuse.",
  },
];

export function componentsForFilePath(filePath: string): RuntimeComponent[] {
  const norm = filePath.replace(/\\/g, "/");
  return OPENNEXO_RUNTIME_COMPONENTS.filter((c) =>
    c.pathPatterns.some((re) => re.test(norm)),
  );
}

export function componentById(id: string): RuntimeComponent | undefined {
  return OPENNEXO_RUNTIME_COMPONENTS.find((c) => c.id === id);
}
