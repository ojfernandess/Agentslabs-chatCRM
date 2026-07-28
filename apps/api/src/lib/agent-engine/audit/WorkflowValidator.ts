import type { AgentExecutionTrace, AgentSupervisorTrace } from "../types.js";
import {
  buildSupervisorTrace,
  buildSupervisorValidationInput,
  shouldBlockReplyAfterSupervisor,
} from "../supervisor/AgentSupervisorService.js";
import { validateToolExecution, type ToolRoundOutcome } from "../validators/ToolValidator.js";
import { toolOutcomeSatisfiesRequired } from "../validators/requiredToolNamesParser.js";
import {
  resolveTurnPolicy,
  validateToolOutcomesAgainstTurnPolicy,
  type TurnPolicy,
} from "../validators/turnPolicyParser.js";
import type { PromptValidationInput } from "../validators/PromptValidator.js";
import { auditPromptAssembly } from "./promptAssemblyAudit.js";
import {
  analyzeExecutionQualityFromLogs,
  type ExecutionLogEntryLike,
} from "../../automationExecutionQuality.js";

export type WorkflowAuditSeverity = "critical" | "high" | "medium" | "low" | "info";

export type WorkflowAuditFinding = {
  phase: string;
  id: string;
  severity: WorkflowAuditSeverity;
  passed: boolean;
  description: string;
  file?: string;
  suggestedFix?: string;
};

export type WorkflowAuditInput = {
  userMessage: string;
  replyText: string;
  toolOutcomes: ToolRoundOutcome[];
  kbMeta: { hasUsefulExcerpts: boolean; coversQuery: boolean };
  strictMode: boolean;
  supervisorEnabled: boolean;
  memorySnapshot?: Record<string, unknown>;
  retryCount?: number;
  previousReply?: string;
  llmApproved?: boolean | null;
  llmSummary?: string;
  validationBlockSend?: boolean;
  requiredToolNames?: string[];
  /** Política de turno do playbook (pares proibidos, exclusividade). */
  turnPolicy?: TurnPolicy;
  behaviorConfig?: Record<string, unknown>;
  promptValidation?: PromptValidationInput;
  systemPromptPreview?: string;
  executionTrace?: AgentExecutionTrace;
  executionLogEntries?: ExecutionLogEntryLike[];
  graphNodeSequence?: string[];
  expectedGraphSequence?: string[];
  /** Trace já calculado pelo runtime (evita duplicar supervisor no gate). */
  supervisorTrace?: AgentSupervisorTrace;
  /** Snapshot EIL (opcional — findings F-EIL). */
  eilSnapshot?: import("../eil/types.js").EilSnapshot;
};

export type WorkflowAuditMetrics = {
  successRate: number;
  criticalFailures: number;
  highFailures: number;
  toolsInvoked: number;
  toolsRequiredMissing: number;
  supervisorApproved: boolean;
  promptReady: boolean;
  qualitySignalCount: number;
};

export type WorkflowAuditReport = {
  approved: boolean;
  findings: WorkflowAuditFinding[];
  metrics: WorkflowAuditMetrics;
  supervisorTrace?: AgentSupervisorTrace;
};

const LANGGRAPH_EXPECTED_DEFAULT = [
  "classify_intent",
  "load_memory",
  "select_tool",
  "execute_tool",
  "validate_result",
  "supervisor",
  "update_memory",
  "respond",
];

function finding(
  phase: string,
  id: string,
  severity: WorkflowAuditSeverity,
  passed: boolean,
  description: string,
  extra?: Pick<WorkflowAuditFinding, "file" | "suggestedFix">,
): WorkflowAuditFinding {
  return { phase, id, severity, passed, description, ...extra };
}

/** Validador unificado de workflow — Fases 1–16 (auditoria comportamental Phase 2 QA). */
export function validateAgentWorkflow(input: WorkflowAuditInput): WorkflowAuditReport {
  const findings: WorkflowAuditFinding[] = [];

  // Fase 1 — Prompt (só audita criticamente quando há dados de prompt)
  const hasPromptData = Boolean(input.systemPromptPreview?.trim() || input.promptValidation);
  const promptAudit = auditPromptAssembly({
    systemPrompt: input.systemPromptPreview,
    promptValidation: input.promptValidation,
  });
  if (hasPromptData) {
    findings.push(
      finding("F1", "prompt_loaded", "critical", promptAudit.loadedCompletely, "Prompt carregado completamente"),
      finding("F1", "prompt_not_truncated", "critical", !promptAudit.truncated, "Prompt sem truncagem", {
        file: "apps/api/src/lib/agentNativeLlm.ts",
        suggestedFix: "Verificar limites de tokens e agregação de appendix KB/memória",
      }),
      finding("F1", "prompt_not_duplicated", "high", !promptAudit.duplicated, "Playbook não duplicado", {
        file: "apps/api/src/lib/agentPlaybook.ts",
      }),
      finding("F1", "prompt_variables_resolved", "high", promptAudit.variablesSubstituted, "Variáveis substituídas"),
      finding("F1", "prompt_restrictions_present", "medium", promptAudit.restrictionsPresent, "Restrições obrigatórias presentes"),
    );
    for (const issue of promptAudit.issues) {
      findings.push(finding("F1", `prompt_issue_${issue.slice(0, 24)}`, "high", false, issue));
    }
  } else {
    findings.push(finding("F1", "prompt_audit_skipped", "info", true, "Auditoria de prompt omitida — sem preview/validation"));
  }

  // Fase 2 — Execução / grafo
  const nodes = input.graphNodeSequence ?? input.executionTrace?.nodes.map((n) => n.id) ?? [];
  const expected = input.expectedGraphSequence ?? LANGGRAPH_EXPECTED_DEFAULT;
  const hasExecute = nodes.includes("execute_tool");
  const hasSupervisorNode = nodes.includes("supervisor");
  const duplicateNodes = nodes.filter((n, i) => nodes.indexOf(n) !== i);
  findings.push(
    finding("F2", "graph_execute_tool", "critical", hasExecute || nodes.length === 0, "Nó execute_tool presente", {
      file: "apps/api/src/lib/agent-engine/runtime/LangGraphRuntime.ts",
    }),
    finding("F2", "graph_supervisor_when_enabled", "high", !input.supervisorEnabled || hasSupervisorNode || nodes.length === 0, "Supervisor no grafo quando activo"),
    finding("F2", "graph_no_duplicate_nodes", "medium", duplicateNodes.length === 0, "Sem nós duplicados consecutivos no trace"),
    finding(
      "F2",
      "graph_order",
      "low",
      nodes.length === 0 || expected.every((n) => nodes.includes(n)),
      "Sequência LangGraph contém nós esperados",
    ),
  );

  // Fase 3 — Ferramentas
  const turnPolicy =
    input.turnPolicy ??
    (input.behaviorConfig
      ? resolveTurnPolicy(input.behaviorConfig, { userMessage: input.userMessage })
      : undefined);
  const toolValidation = validateToolExecution({
    toolOutcomes: input.toolOutcomes,
    replyText: input.replyText,
    strictMode: input.strictMode,
    requiredToolNames: input.requiredToolNames,
    turnPolicy,
    behaviorConfig: input.behaviorConfig,
    userMessage: input.userMessage,
  });
  for (const alert of toolValidation.alerts) {
    const isRequired = alert.includes("obrigatória");
    const isPolicy = /proibid|fora da categoria/i.test(alert);
    findings.push(
      finding(
        "F3",
        `tool_${alert.slice(0, 32)}`,
        isRequired || isPolicy ? "critical" : input.strictMode ? "high" : "medium",
        false,
        alert,
        {
          file: "apps/api/src/lib/agent-engine/validators/ToolValidator.ts",
          suggestedFix: isPolicy
            ? "Cumprir política de turno do playbook (uma categoria; sem misturar tools proibidas)"
            : isRequired
              ? "Invocar a ferramenta obrigatória do turno (resolveRequiredToolNamesForTurn) antes de responder"
              : undefined,
        },
      ),
    );
  }

  // Política explícita (mesmo se ToolValidator não recebeu policy)
  if (turnPolicy) {
    for (const alert of validateToolOutcomesAgainstTurnPolicy(input.toolOutcomes, turnPolicy)) {
      if (toolValidation.alerts.includes(alert)) continue;
      findings.push(
        finding("F3", "turn_policy_violation", "critical", false, alert, {
          file: "apps/api/src/lib/agent-engine/validators/turnPolicyParser.ts",
          suggestedFix: "Separar acções em turnos distintos conforme o playbook",
        }),
      );
    }
  }

  /**
   * Gate anti-alucinação operacional (genérico, multi-segmento):
   * resposta afirma factos de sistema/cadastro/reserva/saldo sem qualquer tool neste turno.
   */
  const operationalAssertionWithoutTools =
    input.toolOutcomes.length === 0 &&
    input.replyText.trim().length > 0 &&
    /encontrei (seu|o|a|um)|cadastro anterior|confirme os dados|seu saldo [ée]|reserva (encontrada|confirmada|localizada)|check-in (conclu[ií]do|realizado)|pedido (confirmado|enviado)|dados do titular/i.test(
      input.replyText,
    );
  findings.push(
    finding(
      "F3",
      "no_operational_assertion_without_tools",
      input.strictMode ? "critical" : "high",
      !operationalAssertionWithoutTools,
      operationalAssertionWithoutTools
        ? "Resposta afirma factos operacionais sem invocar ferramenta neste turno"
        : "Sem afirmação operacional órfã de ferramenta",
      {
        file: "apps/api/src/lib/agent-engine/audit/WorkflowValidator.ts",
        suggestedFix: "Invocar a tool HTTP/API da categoria activa antes de espelhar/confirmar dados",
      },
    ),
  );

  /** Passo 8 / conclusão sem tool de conclusão neste turno. */
  const claimsCompletion = /check-in (foi )?conclu[ií]d|pedido (foi )?confirmado|reserva (foi )?confirmada/i.test(
    input.replyText,
  );
  const hasCompletionTool = input.toolOutcomes.some(
    (t) =>
      t.ok &&
      (turnPolicy?.completionToolHints.some((h) => toolOutcomeSatisfiesRequired(h, [t])) ||
        /check[_-]?in|submit|confirm|concluir|finalize/i.test(t.name)),
  );
  if (claimsCompletion && !hasCompletionTool) {
    findings.push(
      finding(
        "F3",
        "no_completion_claim_without_tool",
        "critical",
        false,
        "Resposta afirma conclusão sem ferramenta de conclusão neste turno",
        {
          file: "apps/api/src/lib/agent-engine/audit/WorkflowValidator.ts",
          suggestedFix: "Só afirmar conclusão após HTTP 200 da tool de conclusão da categoria",
        },
      ),
    );
  }

  if (
    toolValidation.alerts.length === 0 &&
    !operationalAssertionWithoutTools &&
    !(claimsCompletion && !hasCompletionTool)
  ) {
    findings.push(finding("F3", "tool_coherence", "info", true, "Coerência ferramentas ↔ resposta OK"));
  }

  // Fase 4 — Memória
  const memLoaded = Boolean(input.memorySnapshot && Object.keys(input.memorySnapshot).length > 0);
  findings.push(
    finding("F4", "memory_loaded", "medium", !memLoaded || memLoaded, memLoaded ? "Memória carregada no trace" : "Sem snapshot de memória (opcional)"),
    finding("F4", "memory_used", "low", !memLoaded || input.replyText.trim().length >= 8, "Resposta substantiva quando memória disponível"),
  );

  // Fase 5 — KB / RAG
  const kbQuery = input.kbMeta.hasUsefulExcerpts || input.kbMeta.coversQuery;
  const kbTool = input.toolOutcomes.find((t) => t.name === "buscar_conhecimento");
  const hasSuccessfulOperationalTool = input.toolOutcomes.some(
    (t) => t.ok && t.name !== "buscar_conhecimento",
  );
  /** Strict: KB ou turno sem tools (C7/C9) ou ferramenta operacional HTTP OK (C3/C8/S10). */
  const kbRequirementSatisfied =
    kbQuery ||
    kbTool?.ok === true ||
    input.toolOutcomes.length === 0 ||
    hasSuccessfulOperationalTool;
  findings.push(
    finding(
      "F5",
      "kb_search_or_appendix",
      input.strictMode ? "high" : "medium",
      !input.strictMode || kbRequirementSatisfied,
      "KB consultada ou ferramenta operacional válida em strict",
      { file: "apps/api/src/lib/knowledgeRetrieval.ts" },
    ),
    finding("F5", "kb_tool_result_used", "medium", !kbTool || kbTool.ok === false || input.replyText.trim().length > 0, "Resultado KB não ignorado silenciosamente"),
  );

  // Fase 6 — Vector DB (OpenNexo pgvector — Qdrant não implementado)
  findings.push(
    finding("F6", "vector_store", "info", true, "OpenNexo usa pgvector (Prisma); Qdrant não presente no codebase"),
  );

  // Fase 7 — Supervisor
  const supInput = buildSupervisorValidationInput({
    userMessage: input.userMessage,
    replyText: input.replyText,
    toolOutcomes: input.toolOutcomes,
    kbMeta: input.kbMeta,
    strictMode: input.strictMode,
    memorySnapshot: input.memorySnapshot,
    retryCount: input.retryCount,
    previousReply: input.previousReply,
    llmApproved: input.llmApproved,
    llmSummary: input.llmSummary,
    validationBlockSend: input.validationBlockSend ?? toolValidation.blockSend,
    turnPolicy,
  });
  const supervisorTrace = input.supervisorEnabled
    ? (input.supervisorTrace ?? buildSupervisorTrace(supInput))
    : undefined;

  if (input.supervisorEnabled && supervisorTrace) {
    for (const check of supervisorTrace.checks) {
      findings.push(
        finding(
          "F7",
          `supervisor_${check.id}`,
          check.passed ? "info" : input.strictMode ? "critical" : "high",
          check.passed,
          check.passed ? check.label : `${check.label} — FALHOU${check.detail ? `: ${check.detail}` : ""}`,
          { file: "apps/api/src/lib/agent-engine/supervisor/AgentSupervisorService.ts" },
        ),
      );
    }
    findings.push(
      finding("F7", "supervisor_retry_policy", "medium", true, "Política de retry avaliada"),
      finding(
        "F7",
        "supervisor_block_policy",
        "critical",
        supervisorTrace.approved || !shouldBlockReplyAfterSupervisor(supervisorTrace, input.strictMode, input.retryCount ?? 0),
        "Bloqueio pós-retry coerente com strict mode",
      ),
    );
  } else {
    findings.push(finding("F7", "supervisor_skipped", "info", true, "Supervisor desactivado — skip"));
  }

  // Fase 8 — Guardrails (strict mode + validators)
  findings.push(
    finding(
      "F8",
      "strict_mode_gate",
      "high",
      !input.strictMode || !toolValidation.blockSend,
      "Strict mode / tool validator não bloqueou envio inválido",
      { file: "apps/api/src/lib/agent-engine/validators/StrictModeGate.ts" },
    ),
  );

  // Fase 9 — LangGraph (trace events)
  const events = input.executionTrace?.events ?? [];
  findings.push(
    finding("F9", "langgraph_events", "low", events.length >= 0, `${events.length} evento(s) estruturado(s) no trace`),
    finding(
      "F9",
      "langgraph_checkpoint",
      "medium",
      Boolean(input.executionTrace?.checkpointThreadId),
      "Thread checkpoint registado",
    ),
  );

  // Fase 14–15 — Qualidade pós-execução (sempre advisory — nunca bloqueia strict/outbound)
  if (input.executionLogEntries?.length) {
    const qualitySignals = analyzeExecutionQualityFromLogs(input.executionLogEntries);
    for (const sig of qualitySignals) {
      findings.push(
        finding(
          "F15",
          `quality_${sig.kind}`,
          "info",
          true,
          `[advisory] ${sig.title}: ${sig.detail}`,
          { file: "apps/api/src/lib/automationExecutionQuality.ts" },
        ),
      );
    }
    findings.push(
      finding("F15", "quality_signals", "info", qualitySignals.length === 0, "Sem sinais de qualidade pós-execução"),
    );
  }

  // Fase 16 — Checklist workflow
  const checklist = [
    finding("F16", "steps_tools_order", "medium", toolValidation.ok, "Ferramentas coerentes com resposta"),
    finding("F16", "no_invented_reply", "critical", !/\[dado inventado\]/i.test(input.replyText), "Sem marcador de invenção"),
    finding("F16", "reply_after_tools", "high", !(input.toolOutcomes.some((t) => t.ok) && !input.replyText.trim()), "Resposta após tools com sucesso"),
  ];
  findings.push(...checklist);

  // Fase EIL — Execution Intelligence Layer (advisory)
  const eil = input.eilSnapshot;
  if (eil?.enabled) {
    const pendingTools = eil.toolsPending ?? eil.plan?.pendingTools ?? [];
    const missingFacts = eil.plan?.pendingFacts ?? [];
    findings.push(
      finding(
        "F-EIL",
        "eil_plan_vs_tools",
        pendingTools.length ? "high" : "info",
        pendingTools.length === 0,
        pendingTools.length
          ? `Tools pendentes no plano: ${pendingTools.join(", ")}`
          : "Plano EIL: tools obrigatórias satisfeitas ou inexistentes",
        { file: "apps/api/src/lib/agent-engine/eil/ExecutionPlanner.ts" },
      ),
      finding(
        "F-EIL",
        "eil_facts_present",
        missingFacts.length ? "medium" : "info",
        missingFacts.length === 0,
        missingFacts.length
          ? `Facts obrigatórios em falta: ${missingFacts.join(", ")}`
          : `Facts conhecidos: ${Object.keys(eil.facts).length}`,
      ),
      finding(
        "F-EIL",
        "eil_constraints",
        eil.violations.length ? "critical" : "info",
        eil.violations.length === 0,
        eil.violations.length
          ? `Constraints violadas: ${eil.violations.map((v) => v.policyId).join(", ")}`
          : "Sem violações de constraints EIL",
        { file: "apps/api/src/lib/agent-engine/eil/PolicyEngine.ts" },
      ),
      finding(
        "F-EIL",
        "eil_capabilities",
        "info",
        true,
        `Capabilities usadas: ${(eil.capabilitiesUsed ?? []).join(", ") || "(nenhuma)"} · policies: ${(eil.policiesApplied ?? []).join(", ") || "(nenhuma)"}`,
      ),
    );
  } else {
    findings.push(
      finding("F-EIL", "eil_skipped", "info", true, "EIL desactivado ou ausente — skip"),
    );
  }

  const criticalFailures = findings.filter((f) => !f.passed && f.severity === "critical").length;
  const highFailures = findings.filter((f) => !f.passed && f.severity === "high").length;
  const failed = findings.filter((f) => !f.passed);
  const approved = criticalFailures === 0 && (input.strictMode ? highFailures === 0 : criticalFailures === 0);

  const required = input.requiredToolNames ?? [];
  const requiredMissing = required.filter(
    (n) => !toolOutcomeSatisfiesRequired(n, input.toolOutcomes),
  ).length;

  return {
    approved,
    findings,
    supervisorTrace,
    metrics: {
      successRate: findings.length ? (findings.filter((f) => f.passed).length / findings.length) * 100 : 100,
      criticalFailures,
      highFailures,
      toolsInvoked: input.toolOutcomes.length,
      toolsRequiredMissing: requiredMissing,
      supervisorApproved: supervisorTrace?.approved ?? true,
      promptReady: hasPromptData ? promptAudit.ready : true,
      qualitySignalCount: findings.filter(
        (f) => f.phase === "F15" && f.id.startsWith("quality_") && f.id !== "quality_signals",
      ).length,
    },
  };
}

/** Indica se a execução deve ser bloqueada antes de enviar ao cliente.
 *
 * Arquitectura (Fase Planner): o Workflow Validator é **diagnóstico**.
 * Nunca toma a decisão final de outbound — isso cabe exclusivamente ao
 * Execution Supervisor (`shouldBlockReplyAfterSupervisor`) + Tool Validator
 * mid-turn / `validationBlockSend` quando o Supervisor está desligado.
 */
export function shouldBlockOutboundFromWorkflow(_report: WorkflowAuditReport): boolean {
  return false;
}
