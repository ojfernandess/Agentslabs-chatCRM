import { AGS_CATEGORIES, type AgsCategory, type ProposedChange } from "./types.js";
import { componentsForFilePath } from "./componentRegistry.js";

const CATEGORY_RULES: Array<{ category: AgsCategory; patterns: RegExp[] }> = [
  { category: "Scheduler", patterns: [/scheduler\//i, /TurnToolScheduler/i] },
  { category: "Planner", patterns: [/planner\//i, /ExecutionEngine/i, /ExecutionTurnPlan/i] },
  { category: "Supervisor", patterns: [/supervisor\//i] },
  { category: "Workflow Validator", patterns: [/WorkflowValidator/i, /workflow_validator/i] },
  { category: "Prompt Compiler", patterns: [/compiler\//i, /PromptCompiler/i] },
  { category: "Capability Graph", patterns: [/CapabilityGraph/i] },
  { category: "Facts Engine", patterns: [/FactsEngine/i] },
  { category: "Memory", patterns: [/memory\//i, /mem0/i] },
  { category: "Workflow", patterns: [/workflow\//i, /LangGraph/i] },
  { category: "Observabilidade", patterns: [/observability\//i, /Langfuse/i, /mcp-langfuse/i] },
  { category: "Tool Runtime", patterns: [/automationHttpToolExecute/i, /invokeScheduledTools/i] },
  { category: "Runtime", patterns: [/agentNativeLlm/i, /runtime\//i] },
  { category: "Security", patterns: [/sanitize/i, /auth\//i, /permissions/i] },
  { category: "Performance", patterns: [/cache/i, /prefetch/i, /parallel/i] },
  { category: "Streaming", patterns: [/stream/i, /token/i] },
];

export function classifyChange(input: {
  modifiedFiles: string[];
  reason?: string;
  problem?: string;
  explicitCategories?: AgsCategory[];
}): AgsCategory[] {
  const found = new Set<AgsCategory>(input.explicitCategories ?? []);
  const blob = [...input.modifiedFiles, input.reason ?? "", input.problem ?? ""].join("\n");

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(blob))) {
      found.add(rule.category);
    }
  }

  const components = input.modifiedFiles.flatMap((f) => componentsForFilePath(f));
  if (components.some((c) => c.id === "architecture-governance")) found.add("Architecture");
  if (components.some((c) => c.id === "checkin-embratur")) found.add("Tool Runtime");

  if (/\bfix\b|\bbug\b|\bfalha\b|\berro\b/i.test(blob)) found.add("Bug");
  if (/\brefactor/i.test(blob)) found.add("Refactoring");
  if (/\bfeat\b|\bfeature\b|\bnovo\b/i.test(blob)) found.add("Feature");

  if (found.size === 0) found.add("Architecture");

  return [...found].filter((c) => (AGS_CATEGORIES as readonly string[]).includes(c));
}

export function inferPrimaryComponent(proposal: ProposedChange): string {
  if (proposal.component?.trim()) return proposal.component.trim();
  const hits = proposal.modifiedFiles.flatMap((f) => componentsForFilePath(f));
  if (hits.length > 0) return hits[0]!.name;
  return "OpenNexo AI Runtime";
}
