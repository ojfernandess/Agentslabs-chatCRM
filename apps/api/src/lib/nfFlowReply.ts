/**
 * Respostas determinísticas do fluxo C19 (recibo / nota fiscal).
 */

import type { SynthesizerToolOutcome } from "./agent-engine/reply/ReplyTemplateRenderer.js";
import { resolveEstablishmentInConversation, assistantSentReceiptDataForm } from "./unitKnowledgeFlow.js";

function unwrapKbText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

/** Extrai texto da KB a partir do outcome de buscar_conhecimento. */
export function extractKbTextFromToolOutcome(outcome: SynthesizerToolOutcome): string {
  const parts: string[] = [];
  const payload = outcome.structuredPayload;
  if (typeof payload === "string") parts.push(payload);
  else if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const key of ["content", "text", "answer", "result", "excerpt", "excerpts"]) {
      const v = p[key];
      if (typeof v === "string") parts.push(v);
      if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") parts.push(item);
          else if (item && typeof item === "object" && "text" in item) {
            parts.push(String((item as { text?: unknown }).text ?? ""));
          }
        }
      }
    }
  }
  if (outcome.preview) parts.push(outcome.preview);
  return unwrapKbText(parts.join("\n\n"));
}

/** KB indica que a unidade não emite NF (apenas recibo ou política explícita). */
export function kbTextIndicatesReceiptOnlyNoNf(kbText: string): boolean {
  const t = kbText.trim();
  if (!t) return false;
  if (/\bn[aã]o\s+emite\s+(?:nota\s+fiscal|\bnf\b)/i.test(t)) return true;
  if (/\bs[oó]\s+gera\s+recibo\b/i.test(t) && !/\bnota\s+fiscal\s*\(nf\)/i.test(t)) return true;
  if (
    /\b(?:somente|apenas|s[oó])\s+recibo\b/i.test(t) &&
    !/\b(?:emite|emitir)\s+(?:nota\s+fiscal|\bnf\b)/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** KB contém procedimento de emissão de NF (secção ou lista de campos). */
export function kbTextIndicatesNfProcedure(kbText: string): boolean {
  const t = kbText.trim();
  if (!t || kbTextIndicatesReceiptOnlyNoNf(t)) return false;
  const hasNfTopic =
    /\bnota\s+fiscal\s*\(nf\)/i.test(t) ||
    (/\bnota\s+fiscal\b/i.test(t) && /\b(?:emitir|emiss[aã]o|solicitar)\b/i.test(t));
  const hasFormFields =
    [/\bnome\s+completo\b/i, /\bcpf\b/i, /\bcep\b/i, /\btelefone\b/i].filter((r) => r.test(t)).length >= 2;
  return hasNfTopic && hasFormFields;
}

export function buildModeloC19FormReply(): string {
  return `Para emitir sua nota fiscal, preciso dos dados abaixo. Preencha e envie nesta conversa:

- Nome completo
- CPF ou CNPJ
- Endereço
- CEP
- Telefone
- Período (check-in a check-out)
- Valor
- Unidade
- E-mail
- Hóspede
- Quarto`;
}

export function buildModeloC19ReceiptOnlyReply(establishmentName: string): string {
  const unit = establishmentName.trim() || "este estabelecimento";
  return (
    `Consultei a política da unidade: a *${unit}* **não emite nota fiscal**, mas **pode emitir recibo** da hospedagem.\n\n` +
    "Deseja solicitar o **recibo**? Responda **sim** para continuarmos."
  );
}

function parseLabeledReceiptFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const value = line.slice(colonIdx + 1).trim();
    const key = line
      .slice(0, colonIdx)
      .replace(/[\u{1F300}-\u{1FAFF}\uFE0F]/gu, "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    fields[key] = value;
  }
  return fields;
}

function receiptField(fields: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const v = fields[key];
    if (v && v.trim()) return v.trim();
  }
  return "…";
}

/** Monta espelho de confirmação a partir do bloco enviado pelo hóspede (recibo PF/PJ). */
export function buildReceiptMirrorFromUserSubmission(
  userMessage: string,
  lastAssistantMessage?: string | null,
): string | null {
  const t = userMessage.trim();
  if (!t) return null;
  const fields = parseLabeledReceiptFields(t);
  const isPj =
    /\braz[aã]o social\b/i.test(t) ||
    /\bcnpj\b/i.test(t) ||
    /\bpessoa jur[ií]dica\b/i.test(lastAssistantMessage ?? "");
  const hospedagem = receiptField(fields, "nome da hospedagem");
  const localizadorRaw = receiptField(fields, "localizador da reserva", "localizador da reserva (opcional)", "número da reserva", "numero da reserva");
  const localizador =
    !localizadorRaw || localizadorRaw === "…" ? "*não informado*" : localizadorRaw;
  const quarto = receiptField(fields, "quarto");
  const checkIn = receiptField(fields, "check-in", "checkin");
  const checkout = receiptField(fields, "checkout", "check-out");

  if (isPj) {
    const razao = receiptField(fields, "razão social", "razao social");
    const cnpj = receiptField(fields, "cnpj");
    return `Confira os dados para emissão do recibo (pessoa jurídica):

🏨 Nome da hospedagem: ${hospedagem}
🔢 Localizador da reserva (opcional): ${localizador}
🏢 Razão Social: ${razao}
🆔 CNPJ: ${cnpj}
🛏️ Quarto: ${quarto}
⏰ Check-in: ${checkIn}
⏰ Checkout: ${checkout}

Está tudo correto? Responda **sim** para eu encaminhar ao setor responsável. Se precisar corrigir algum dado, envie a alteração nesta conversa.`;
  }

  return `Confira os dados para emissão do recibo (pessoa física):

🏨 Nome da hospedagem: ${hospedagem}
🔢 Localizador da reserva (opcional): ${localizador}
🛏️ Quarto: ${quarto}
⏰ Check-in: ${checkIn}
⏰ Checkout: ${checkout}

Está tudo correto? Responda **sim** para eu encaminhar ao setor responsável. Se precisar corrigir algum dado, envie a alteração nesta conversa.`;
}

export function replyLooksLikeReceiptConfirmationMirror(reply?: string | null): boolean {
  const t = (reply ?? "").trim();
  if (!t) return false;
  return /\bconfira os dados\b/i.test(t) && /\brecibo\b/i.test(t) && /🏨/.test(t);
}

export function tryReceiptFormSubmissionReply(input: {
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  replyText?: string | null;
}): string | null {
  if (!assistantSentReceiptDataForm(input.lastAssistantMessage)) return null;
  if (replyLooksLikeReceiptConfirmationMirror(input.replyText)) return null;
  return buildReceiptMirrorFromUserSubmission(input.userMessage ?? "", input.lastAssistantMessage);
}

export function replyLooksLikeNfDataFormWithLocator(reply?: string | null): boolean {
  const t = (reply ?? "").trim();
  if (!t) return false;
  return (
    /\blocalizador\b/i.test(t) &&
    /\b(?:nota\s+fiscal|\bnf\b)\b/i.test(t) &&
    /\bnome\s+completo\b/i.test(t)
  );
}

export function replyLooksLikeNfDataForm(reply?: string | null): boolean {
  const t = (reply ?? "").trim();
  if (!t) return false;
  return (
    /\b(?:nota\s+fiscal|\bnf\b)\b/i.test(t) &&
    [/\bnome\s+completo\b/i, /\bcpf\b/i, /\bcep\b/i, /\btelefone\b/i].filter((r) => r.test(t)).length >= 2
  );
}

export type NfKbReplyInput = {
  replyText?: string | null;
  userMessage?: string | null;
  lastAssistantMessage?: string | null;
  flowSlots?: Record<string, string | number | boolean>;
  kbTool: SynthesizerToolOutcome;
};

/** Resposta determinística pós-KB na escolha de unidade C19, ou null se LLM pode responder. */
export function tryNfEstablishmentKbReply(input: NfKbReplyInput): string | null {
  const establishment =
    resolveEstablishmentInConversation({
      userMessage: input.userMessage,
      lastAssistantMessage: input.lastAssistantMessage,
      flowSlots: input.flowSlots,
    }) ?? "";
  const kbText = extractKbTextFromToolOutcome(input.kbTool);
  const audaarReceiptOnly = /audaar\s*tech/i.test(establishment);
  if (audaarReceiptOnly || kbTextIndicatesReceiptOnlyNoNf(kbText)) {
    return buildModeloC19ReceiptOnlyReply(establishment || "Audaar Tech Suites");
  }
  if (
    kbTextIndicatesNfProcedure(kbText) &&
    (!replyLooksLikeNfDataForm(input.replyText) ||
      replyLooksLikeNfDataFormWithLocator(input.replyText))
  ) {
    return buildModeloC19FormReply();
  }
  return null;
}
