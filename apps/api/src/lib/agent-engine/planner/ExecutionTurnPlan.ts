import {
  resolveRequiredToolNamesForTurn,
  toolNamesMatch,
} from "../validators/requiredToolNamesParser.js";
import {
  classifyConfirmationGate,
  isConfirmationUserMessage,
  resolveTurnPolicy,
  type TurnPolicy,
} from "../validators/turnPolicyParser.js";
import { userMessageLooksLikeKnowledgeSeekingQuery } from "../../knowledgeQueryEnrichment.js";
import { isContinuationSyntheticMessage } from "../continuation/constants.js";

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
  /** Última mensagem outbound do agente — desambigua sim titular→S9 vs ficha→S10. */
  lastAssistantMessage?: string;
};

/**
 * Constrói o plano de execução do turno actual a partir do playbook + mensagem.
 * Deve ser chamado uma vez por turno e reutilizado por Tool Validator / Supervisor / WF.
 */
export function buildExecutionTurnPlan(opts: BuildExecutionTurnPlanOpts): ExecutionTurnPlan {
  const userMessage = (opts.userMessage ?? "").trim();
  const lastAssistantMessage = (opts.lastAssistantMessage ?? "").trim();
  let requiredToolNames = resolveRequiredToolNamesForTurn(opts.behaviorConfig, {
    userMessage,
    availableToolNames: opts.availableToolNames,
  });
  let turnPolicy = resolveTurnPolicy(opts.behaviorConfig, {
    userMessage,
    lastAssistantMessage,
  });
  const knowledgeSeeking = userMessageLooksLikeKnowledgeSeekingQuery(userMessage);

  // Infer pattern ids from required tools / message (leve — sem re-export circular)
  const matchedPatternIds: string[] = [];
  const isContinuation = isContinuationSyntheticMessage(userMessage);
  if (!isContinuation && /^\d{11}$/.test(userMessage)) matchedPatternIds.push("document_id");
  if (
    !isContinuation &&
    /check[- ]?in|verificar\s+(?:essa\s+|a\s+)?reserva|consultar\s+(?:essa\s+|a\s+)?reserva|pode\s+consultar|status\s+(da\s+)?reserva/i.test(
      userMessage,
    )
  ) {
    matchedPatternIds.push("checkin_or_reservation");
  }
  if (
    !isContinuation &&
    /reclam|irritad|falar com (humano|atendente|pessoa)|quero (um )?humano|p[eé]ssim/i.test(userMessage)
  ) {
    matchedPatternIds.push("escalation");
  }
  if (isContinuation) matchedPatternIds.push("proactive_continuation");

  // Confirmação curta: exigir a tool exclusiva do Portão (titular→S9 / ficha→S10)
  if (!isContinuation && isConfirmationUserMessage(userMessage)) {
    const gate = classifyConfirmationGate(lastAssistantMessage);
    const available = (opts.availableToolNames ?? []).map((n) => n.toLowerCase());
    const filterAvailable = (names: string[]) => {
      if (available.length === 0) return names;
      const kept = names.filter((n) =>
        available.some((a) => toolNamesMatch(n, a)),
      );
      return kept.length > 0 ? kept : names;
    };
    if (gate === "titular_mirror") {
      matchedPatternIds.push("confirmation_titular");
      if (turnPolicy.exclusiveAllowedTools?.length) {
        const exclusive = filterAvailable(turnPolicy.exclusiveAllowedTools);
        turnPolicy = { ...turnPolicy, exclusiveAllowedTools: exclusive };
        const merged = new Set([...requiredToolNames, ...exclusive]);
        requiredToolNames = [...merged];
      }
    } else if (gate === "travel_form_mirror") {
      matchedPatternIds.push("confirmation_travel_form");
      if (turnPolicy.exclusiveAllowedTools?.length) {
        const exclusive = filterAvailable(turnPolicy.exclusiveAllowedTools);
        turnPolicy = { ...turnPolicy, exclusiveAllowedTools: exclusive };
        const merged = new Set([...requiredToolNames, ...exclusive]);
        requiredToolNames = [...merged];
      }
    } else if (gate === "data_collection") {
      matchedPatternIds.push("confirmation_data_collection");
    }
  }

  return {
    userMessage,
    requiredToolNames,
    turnPolicy,
    knowledgeSeeking,
    matchedPatternIds,
  };
}
