/**
 * Self Healing — detecta padrões recorrentes e aplica mitigações genéricas.
 */

import type { ExecutionAuditReport, SelfHealingPattern } from "./types.js";

export type SelfHealingInput = {
  audit: Partial<ExecutionAuditReport>;
  supervisorRetries?: number;
  validationAlerts?: string[];
  fallbackUsed?: boolean;
  replyOnlyRetry?: boolean;
};

const PATTERN_DEFS: Array<{
  id: string;
  label: string;
  detect: (input: SelfHealingInput) => boolean;
  mitigation: string;
}> = [
  {
    id: "required_tool_ignored",
    label: "Required tool ignorada",
    detect: (i) => (i.audit.pendingTools?.length ?? 0) > 0 && (i.audit.executedTools?.length ?? 0) > 0,
    mitigation: "Tool Orchestrator força mandatoryNextTool antes de reply",
  },
  {
    id: "forbidden_tool_executed",
    label: "Tool proibida executada",
    detect: (i) =>
      i.audit.divergences?.some((d) => d.kind === "forbidden_tool_used") ?? false,
    mitigation: "Pre-exec block + allowlist filtrada no LLM",
  },
  {
    id: "retry_worsens_state",
    label: "Retry piora estado",
    detect: (i) =>
      (i.supervisorRetries ?? 0) >= 2 &&
      (i.audit.pendingTools?.length ?? 0) > 0,
    mitigation: "Reply-only retry quando tools OK; full retry só sem side-effects",
  },
  {
    id: "supervisor_repeated_block",
    label: "Supervisor bloqueia repetidamente",
    detect: (i) => (i.supervisorRetries ?? 0) >= 2 && (i.audit.blocks?.length ?? 0) > 0,
    mitigation: "Supervisor valida contratos, não texto; recovery antes de blockReply",
  },
  {
    id: "workflow_validator_late",
    label: "WF detecta erro tarde",
    detect: (i) =>
      (i.validationAlerts?.length ?? 0) > 0 &&
      (i.audit.divergences?.some((d) => d.severity === "critical") ?? false),
    mitigation: "Pre-execution validation + consistency check pós-tool",
  },
  {
    id: "fallback_strips_tools",
    label: "Fallback elimina Tool Calling",
    detect: (i) => i.fallbackUsed === true && (i.audit.pendingTools?.length ?? 0) > 0,
    mitigation: "SmartFallback bloqueia plain-chat com tools pendentes",
  },
  {
    id: "llm_chose_wrong_tools",
    label: "LLM escolheu tools incorrectas",
    detect: (i) => {
      const executed = i.audit.executedTools ?? [];
      const pending = i.audit.pendingTools ?? [];
      return executed.length > 0 && pending.length > 0 && executed.every((t) => !pending.includes(t));
    },
    mitigation: "Runtime V2 allowlist + mandatoryNextTool no prompt",
  },
];

/** Detecta padrões recorrentes observados na execução. */
export function detectSelfHealingPatterns(input: SelfHealingInput): SelfHealingPattern[] {
  return PATTERN_DEFS.map((def) => ({
    id: def.id,
    label: def.label,
    detected: def.detect(input),
    mitigation: def.mitigation,
  }));
}

/** Retorna mitigações activas para padrões detectados. */
export function activeMitigations(patterns: SelfHealingPattern[]): string[] {
  return patterns.filter((p) => p.detected).map((p) => p.mitigation);
}
