/**
 * Intent Analyzer — interpreta playbook e mensagem sem escolher tools.
 * Responsabilidade única: classificar intenção e entidades.
 */
import type { ExecutionTurnPlan } from "../planner/ExecutionTurnPlan.js";
import type { IntentAnalysis, IntentKind } from "../core/types.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import { shouldRequireCallHumanThisTurn } from "../escalation/escalationTurnDetection.js";
import type { StaticPromptIRExtract } from "./extractStaticPromptIR.js";

export type PlaybookIntentSummary = {
  hasFlows: boolean;
  flowStepCount: number;
  policyCount: number;
  catalogToolCount: number;
  hasCompletionCriteria: boolean;
  hasReplyTemplates: boolean;
};

/** Resumo estático do playbook compilado — observabilidade / audit. */
export function summarizePlaybookIntent(staticIr: StaticPromptIRExtract): PlaybookIntentSummary {
  return {
    hasFlows: staticIr.flows.length > 0,
    flowStepCount: staticIr.flows.reduce((n, f) => n + f.steps.length, 0),
    policyCount: staticIr.policies.length,
    catalogToolCount: staticIr.toolsCatalog.length,
    hasCompletionCriteria: staticIr.completionCriteria.length > 0,
    hasReplyTemplates: staticIr.replyTemplates.length > 0,
  };
}

/**
 * Analisa intenção do turno — delega padrões ao turnPlan (IR turnPatterns registry).
 * Nunca selecciona ferramentas nem políticas.
 */
export function analyzeTurnIntent(userMessage: string, turnPlan: ExecutionTurnPlan): IntentAnalysis {
  const msg = (userMessage ?? "").trim();
  let kind: IntentKind = "general";
  let confidence = 0.55;

  if (turnPlan.matchedPatternIds.includes("structured_form_submission")) {
    kind = "data_submission";
    confidence = 0.88;
  } else if (
    turnPlan.requiredToolNames.some((n) => /disponibilidade|availability/i.test(n)) ||
    turnPlan.matchedPatternIds.some((id) =>
      ["quote_request", "quote_stay_details", "availability_quote"].includes(id),
    )
  ) {
    kind = "operational_action";
    confidence = 0.85;
  } else if (
    turnPlan.matchedPatternIds.includes("escalation") ||
    shouldRequireCallHumanThisTurn({ userMessage: msg })
  ) {
    kind = "escalation_request";
    confidence = 0.85;
  } else if (turnPlan.knowledgeSeeking || userMessageLooksLikeKnowledgeSeekingQuery(msg)) {
    kind = "knowledge_query";
    confidence = 0.85;
  } else if (/^(sim|ok|confirmo|yes|não|nao|no)$/i.test(msg)) {
    kind = "confirmation";
    confidence = 0.9;
  } else if (/^\d{11}$/.test(msg) || /^[A-Z0-9]{6,12}$/i.test(msg)) {
    kind = "data_submission";
    confidence = 0.8;
  } else if (turnPlan.requiredToolNames.length > 0) {
    kind = "operational_action";
    confidence = 0.7;
  }

  const entities: Record<string, string> = {};
  const doc = msg.match(/\b\d{11}\b/);
  if (doc) entities.documentNumber = doc[0];
  const loc = msg.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i);
  if (loc) entities.referenceCode = loc[0].toUpperCase();

  return {
    kind,
    confidence,
    entities,
    expectedGoal: kind === "knowledge_query" ? "answer_from_knowledge" : "complete_operational_flow",
  };
}
