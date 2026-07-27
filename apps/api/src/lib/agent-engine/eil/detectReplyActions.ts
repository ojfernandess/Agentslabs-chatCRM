import type { ReplyActionId } from "./types.js";

/**
 * Detecta acções genéricas no texto da resposta.
 * Heurísticas multi-idioma / multi-segmento — sem regras de hotel/clínica.
 */
export function detectReplyActions(replyText: string): ReplyActionId[] {
  const t = (replyText ?? "").trim();
  if (!t) return [];
  const actions: ReplyActionId[] = [];

  // Pedido de dados de outra pessoa / party adicional (genérico)
  if (
    /\b(acompanhante|additional\s+(guest|party|person)|companion|outra\s+pessoa|segundo\s+hóspede|co-?titular|dependente|convidado\s+adicional)\b/i.test(
      t,
    ) ||
    /dados\s+d[oe]\s+(acompanhante|companion|convidado|dependente)/i.test(t) ||
    /cadastr(ar|e)\s+(o\s+)?(acompanhante|companion|additional)/i.test(t)
  ) {
    actions.push("request_additional_party");
  }

  if (
    /\b(sim\/não|sim\/nao|confirma|está\s+correto|esta\s+correto|está\s+certo|pode\s+confirmar|confirm\s+(please|these|your))\b/i.test(
      t,
    ) ||
    /\?\s*$/.test(t) && /\b(correto|certo|ok|confirma)\b/i.test(t)
  ) {
    actions.push("confirm");
  }

  if (
    /\b(atendente|humano|humano|transfer|escalon|falar\s+com\s+(um\s+)?(humano|atendente|pessoa)|call_human|transfer_to_team)\b/i.test(
      t,
    )
  ) {
    actions.push("escalate_human");
  }

  if (
    /\b(cpf|passaporte|passport|documento|rg\b|document\s+number|número\s+do\s+documento)\b/i.test(t) &&
    /\b(envie|envia|informe|digite|mande|send|provide|preciso\s+d[oe])\b/i.test(t)
  ) {
    actions.push("ask_document");
  }

  if (
    /\b(pagamento|payment|invoice|fatura|pix|cart[aã]o|boleto)\b/i.test(t) &&
    /\b(pendente|status|comprovante|pague|pagar|paid)\b/i.test(t)
  ) {
    actions.push("ask_payment");
  }

  if (
    /\b(check[- ]?in\s+conclu|finalizad[oa]|concluímos|completed|all\s+set|tudo\s+certo[,.]?\s*(seu|o)\s+check)\b/i.test(
      t,
    )
  ) {
    actions.push("complete_flow");
  }

  return [...new Set(actions)];
}
