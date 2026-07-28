/**
 * Strict Mode Rescue — respostas de fallback genéricas quando o gate estrutural bloqueia envio.
 * Evita dump de paths JSON (`data.reservation.*`) e preserva replies já aprovadas pelo supervisor IA.
 */

import { isConfirmationUserMessage } from "./turnPolicyParser.js";

/** Chaves técnicas/internas — nunca mostrar ao cliente (segment-agnostic). */
const INTERNAL_SCALAR_LEAF_RE =
  /^(uid|uuid|guid|documenttype|type|statuscode|channelstatus|reservationstatus|categoryid|establishmentid|groupreservationid|responsibleid|reservationid|cmrstatus|fnrhid|localizeddate|checkinactiondate|checkoutactiondate|reservationdate|totalpaid|ispaid|ok|found|skipped|error|bodypreview|reason|message|headers|raw|html|token|password|secret|apikey|authorization)$/i;

/** Converte path JSON (`data.guest.name`) em rótulo legível (`Name`). */
export function formatScalarFactLabel(pathKey: string): string {
  const leaf = (pathKey.includes(".") ? pathKey.split(".").pop() : pathKey) ?? pathKey;
  const spaced = leaf
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  if (!spaced) return pathKey;
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isInternalScalarLeaf(leafKey: string): boolean {
  const normalized = leafKey.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (INTERNAL_SCALAR_LEAF_RE.test(normalized)) return true;
  if (/^id$/.test(normalized) || /id$/.test(normalized) && normalized.length <= 16) {
    return /^(reservationid|groupreservationid|responsibleid|establishmentid|categoryid)$/.test(
      normalized,
    );
  }
  return false;
}

/** True quando a última mensagem do agente pediu confirmação explícita ao hóspede. */
export function assistantAskedForConfirmation(lastAssistantMessage: string): boolean {
  const t = lastAssistantMessage.trim();
  if (!t) return false;
  return /\b(confirma\??|confirmar|est[aá]\s+correto|est[aá]\s+certo|correto\??|certo\??|confirme|estão\s+correctos|estao\s+corretos)\b/i.test(
    t,
  );
}

/**
 * Confirmação grounded só em turnos de confirmação — nunca após lookup/consulta inicial.
 * Genérico: baseado na mensagem do utilizador e no pedido anterior do agente, não no domínio.
 */
export function shouldOfferGroundedConfirmationRescue(
  userMessage: string,
  lastAssistantMessage: string,
): boolean {
  if (isConfirmationUserMessage(userMessage)) return true;
  return assistantAskedForConfirmation(lastAssistantMessage);
}

export type StrictModeRescueInput = {
  originalReply: string;
  userMessage: string;
  lastAssistantMessage?: string;
  llmSupervisorApproved?: boolean | null;
  toolOutcomes: Array<{ name: string; ok: boolean; preview: string; structuredPayload?: unknown }>;
  hasSubstantiveReply: (text: string) => boolean;
  matchedPatternIds?: string[];
  buildCompletionSuccessAck: (
    toolOutcomes: StrictModeRescueInput["toolOutcomes"],
  ) => string | null;
  buildAdvanceAskFromReferenceCatalog?: (
    toolOutcomes: StrictModeRescueInput["toolOutcomes"],
  ) => string | null;
  buildGroundedConfirmation: (
    toolOutcomes: StrictModeRescueInput["toolOutcomes"],
  ) => string | null;
  buildDeterministicReply: (toolOutcomes: StrictModeRescueInput["toolOutcomes"]) => string;
};

export type StrictModeRescueResult = {
  reply: string | null;
  kind:
    | "supervisor_preserve"
    | "completion_ack"
    | "advance_form_ask"
    | "grounded_confirmation"
    | "humanized_tool_summary"
    | null;
};

/**
 * Escolhe fallback quando modo estrito bloqueia envio mas tools correram com sucesso.
 * Prioridade genérica — qualquer agente/playbook.
 */
export function resolveStrictModeRescueReply(input: StrictModeRescueInput): StrictModeRescueResult {
  const original = input.originalReply.trim();
  const successful = input.toolOutcomes.filter((t) => t.ok);
  if (successful.length === 0) {
    return { reply: null, kind: null };
  }

  if (
    input.llmSupervisorApproved === true &&
    original &&
    input.hasSubstantiveReply(original)
  ) {
    return { reply: original, kind: "supervisor_preserve" };
  }

  const completionAck = input.buildCompletionSuccessAck(input.toolOutcomes);
  if (completionAck) {
    return { reply: completionAck, kind: "completion_ack" };
  }

  const advanceAsk =
    input.matchedPatternIds?.includes("confirmation_titular") &&
    input.buildAdvanceAskFromReferenceCatalog
      ? input.buildAdvanceAskFromReferenceCatalog(input.toolOutcomes)
      : null;
  if (advanceAsk) {
    return { reply: advanceAsk, kind: "advance_form_ask" };
  }

  if (
    shouldOfferGroundedConfirmationRescue(
      input.userMessage,
      input.lastAssistantMessage ?? "",
    )
  ) {
    const grounded = input.buildGroundedConfirmation(input.toolOutcomes);
    if (grounded) {
      return { reply: grounded, kind: "grounded_confirmation" };
    }
  }

  const humanized = input.buildDeterministicReply(input.toolOutcomes);
  if (humanized.trim()) {
    return { reply: humanized, kind: "humanized_tool_summary" };
  }

  return { reply: null, kind: null };
}
