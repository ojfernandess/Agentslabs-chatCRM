/**
 * GATE C18 / lacuna global de KB — quando `buscar_conhecimento` não cobre a pergunta
 * e o playbook não tem resposta determinística, escalar com `call_human`.
 */

import type { SynthesizerToolOutcome } from "./agent-engine/reply/ReplyTemplateRenderer.js";
import {
  messageLooksLikeEscalationTurn,
  messageLooksLikeReservationPaymentOperational,
  messageLooksLikeReservationUpdateRequest,
  messageLooksLikeVagueProblemReport,
  userMessageLooksLikeAccessBlockedProblem,
} from "./agent-engine/escalation/escalationTurnDetection.js";
import { extractKbTextFromToolOutcome } from "./nfFlowReply.js";
import {
  isOperationalQuoteMessage,
  knowledgeContentCoversQuery,
  userMessageLooksLikeKnowledgeSeekingQuery,
} from "./knowledgeQueryEnrichment.js";
import {
  userMessageLooksLikeAmenityItemQuestion,
  userMessageLooksLikeCheckoutProcedureQuestion,
  userMessageLooksLikeEstablishmentEntryFaqQuestion,
  userMessageLooksLikeReceiptOrInvoiceRequest,
} from "./unitKnowledgeFlow.js";

export function kbOutcomeCoversUserQuery(
  kbOutcome: SynthesizerToolOutcome | undefined,
  userMessage?: string | null,
): boolean {
  if (!kbOutcome || kbOutcome.ok === false) return false;
  const q = (userMessage ?? "").trim();
  if (!q) return false;
  const kbText = extractKbTextFromToolOutcome(kbOutcome);
  if (!kbText.trim()) return false;
  return knowledgeContentCoversQuery(kbText, q);
}

/** Pergunta factual que depende de KB/playbook e deve escalar se a KB não responder. */
export function userMessageLooksLikeKbEscalationCandidate(userMessage?: string | null): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  if (messageLooksLikeEscalationTurn(msg)) return false;
  if (messageLooksLikeReservationPaymentOperational(msg)) return false;
  if (messageLooksLikeReservationUpdateRequest(msg)) return false;
  if (messageLooksLikeVagueProblemReport(msg)) return false;
  if (isOperationalQuoteMessage(msg)) return false;
  if (userMessageLooksLikeAccessBlockedProblem(msg)) return false;
  if (userMessageLooksLikeEstablishmentEntryFaqQuestion(msg)) return false;

  if (
    userMessageLooksLikeCheckoutProcedureQuestion(msg) ||
    userMessageLooksLikeReceiptOrInvoiceRequest(msg) ||
    userMessageLooksLikeAmenityItemQuestion(msg)
  ) {
    return true;
  }

  return userMessageLooksLikeKnowledgeSeekingQuery(msg);
}

export function findKnowledgeToolOutcome(
  toolOutcomes: SynthesizerToolOutcome[],
): SynthesizerToolOutcome | undefined {
  return toolOutcomes.find((t) => t.ok !== false && /^buscar_conhecimento$/i.test(t.name));
}

export function shouldEscalateAfterKnowledgeGap(opts: {
  userMessage?: string | null;
  toolOutcomes: SynthesizerToolOutcome[];
  callHumanSucceeded?: boolean;
}): boolean {
  if (opts.callHumanSucceeded) return false;
  if (!userMessageLooksLikeKbEscalationCandidate(opts.userMessage)) return false;
  const kbOutcome = findKnowledgeToolOutcome(opts.toolOutcomes);
  if (!kbOutcome) return false;
  return !kbOutcomeCoversUserQuery(kbOutcome, opts.userMessage);
}

export function buildKnowledgeGapHandoffReply(): string {
  return (
    "Não encontrei essa informação na nossa base de conhecimento neste momento. " +
    "Vou encaminhar sua pergunta para um atendente, que irá verificar e retornar em breve."
  );
}

export function isKnowledgeGapSynthesizerReason(reason?: string): boolean {
  return reason === "knowledge_gap_escalation" || reason === "knowledge_gap_call_human_missing";
}
