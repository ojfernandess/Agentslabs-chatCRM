import {
  resolveRequiredToolNamesForTurn,
} from "../validators/requiredToolNamesParser.js";
import { resolveTurnPolicy, type TurnPolicy } from "../validators/turnPolicyParser.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";

/**
 * Plano de turno — fonte única de verdade para tools obrigatórias e política.
 * O LLM ainda escolhe argumentos; o runtime usa este plano para validar e orientar
 * retries (Supervisor), sem deixar o Workflow Validator decidir outbound.
 */
export type ExecutionTurnPlan = {
  userMessage: string;
  requiredToolNames: string[];
  turnPolicy: TurnPolicy;
  knowledgeSeeking: boolean;
  /** Categorias heurísticas detectadas (ids de GENERIC_TURN_PATTERNS). */
  matchedPatternIds: string[];
};

export type BuildExecutionTurnPlanOpts = {
  behaviorConfig: Record<string, unknown> | null | undefined;
  userMessage: string;
  availableToolNames?: string[];
};

/**
 * Constrói o plano de execução do turno actual a partir do playbook + mensagem.
 * Deve ser chamado uma vez por turno e reutilizado por Tool Validator / Supervisor / WF.
 */
export function buildExecutionTurnPlan(opts: BuildExecutionTurnPlanOpts): ExecutionTurnPlan {
  const userMessage = (opts.userMessage ?? "").trim();
  const requiredToolNames = resolveRequiredToolNamesForTurn(opts.behaviorConfig, {
    userMessage,
    availableToolNames: opts.availableToolNames,
  });
  const turnPolicy = resolveTurnPolicy(opts.behaviorConfig, { userMessage });
  const knowledgeSeeking = userMessageLooksLikeKnowledgeSeekingQuery(userMessage);

  // Infer pattern ids from required tools / message (leve — sem re-export circular)
  const matchedPatternIds: string[] = [];
  if (/^\d{11}$/.test(userMessage)) matchedPatternIds.push("document_id");
  if (
    /check[- ]?in|verificar\s+(?:essa\s+|a\s+)?reserva|consultar\s+(?:essa\s+|a\s+)?reserva|pode\s+consultar|status\s+(da\s+)?reserva/i.test(
      userMessage,
    )
  ) {
    matchedPatternIds.push("checkin_or_reservation");
  }
  if (/reclam|irritad|falar com (humano|atendente|pessoa)|quero (um )?humano|p[eé]ssim/i.test(userMessage)) {
    matchedPatternIds.push("escalation");
  }

  return {
    userMessage,
    requiredToolNames,
    turnPolicy,
    knowledgeSeeking,
    matchedPatternIds,
  };
}
