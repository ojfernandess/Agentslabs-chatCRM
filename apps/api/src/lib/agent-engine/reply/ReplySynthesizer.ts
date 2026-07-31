import {
  hasSubstantiveAgentReplyToCustomer,
  isNonDeliveringAgentReply,
} from "./ReplyQuality.js";
import { buildDeterministicReplyFromToolOutcomes } from "./DeterministicReplyFromTools.js";
import type { PromptIR } from "../contract/PromptIR.js";
import { templateFactsFromEnrichedIr } from "../compiler/playbookEnrichment.js";
import {
  extractReservationDisplayFields,
  factsFromReservationPayload,
  matchIrReplyTemplate,
  renderReplyTemplate,
  resolveReservationLookupTemplateId,
  type SynthesizerToolOutcome,
} from "./ReplyTemplateRenderer.js";

export type { SynthesizerToolOutcome };

export type EnsureDeliveringReplyInput = {
  replyText: string;
  toolOutcomes: SynthesizerToolOutcome[];
  userMessage?: string;
  configuredStallMessages?: string[];
  /** Prompt IR — templates de resposta (Fase 6). */
  promptIr?: PromptIR;
};

export type EnsureDeliveringReplyResult = {
  reply: string;
  replaced: boolean;
  reason?:
    | "tool_narration"
    | "stall"
    | "empty"
    | "reservation_s1"
    | "embratur_s9"
    | "check_in_ack"
    | "companion_s4c"
    | "ir_template"
    | "deterministic_fallback"
    | "quote_availability_failed";
};

export { extractReservationDisplayFields };

function tryParseJson(preview: string): unknown {
  try {
    return JSON.parse(preview);
  } catch {
    return null;
  }
}

function dig(obj: unknown, paths: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const path of paths) {
    let cur: unknown = obj;
    for (const p of path.split(".")) {
      if (!cur || typeof cur !== "object" || !(p in (cur as object))) {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur != null && cur !== "") return cur;
  }
  return undefined;
}

/** @deprecated Use renderReplyTemplate — mantido para compat. */
export function buildModeloS1FromReservationPayload(
  payload: unknown,
  opts?: { userMessage?: string },
): string {
  const facts = {
    ...factsFromReservationPayload(payload, opts?.userMessage),
    checkinLink: "https://pms.audaar.com.br/checkin/vivapp/access",
  };
  const templateId = resolveReservationLookupTemplateId(facts);
  return renderReplyTemplate({ templateId, facts, userMessage: opts?.userMessage });
}

export function replyLooksLikeModeloS1(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const hasFacts =
    /📍\s*Hospedagem|Hospedagem\s*:/i.test(t) &&
    /📅\s*Check-in|Check-in\s*:/i.test(t) &&
    /👥\s*Hóspedes|Hóspedes\s*:/i.test(t);
  if (!hasFacts) return false;
  if (/encontramos\s+sua\s+reserva\s+com\s+sucesso/i.test(t)) {
    return (
      /checkin\/vivapp\/access/i.test(t) &&
      /1️⃣|realize\s+seu\s+cadastro|informe\s+o\s+localizador/i.test(t) &&
      /ainda\s+n[aã]o\s+foi\s+realizado/i.test(t)
    );
  }
  return (
    /encontrei\s+sua\s+reserva/i.test(t) &&
    (/deseja\s+fazer\s+o\s+check-in\s+agora|check-in:\s*já\s+realizado|check-in:\s*pendente/i.test(t) ||
      /pelo\s+link:.*checkin/i.test(t))
  );
}

export function userMessageLooksLikeCheckInTurn(userMessage?: string): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  if (/\bcheck[- ]?in\b/i.test(msg)) return true;
  if (/\bfazer\s+check\b/i.test(msg)) return true;
  if (/\breserva\b/i.test(msg) && /\b[A-Z0-9]{6,12}\b/i.test(msg)) return true;
  return false;
}

function findReservationLookupOutcome(
  outcomes: SynthesizerToolOutcome[],
): SynthesizerToolOutcome | null {
  const ok = outcomes.filter((t) => t.ok !== false);
  return (
    ok.find((t) => /consultar[_-]?reserva/i.test(t.name)) ??
    ok.find((t) => {
      const p = t.structuredPayload ?? tryParseJson(t.preview);
      return dig(p, ["checkinDate", "data.checkinDate", "guestsQuantity"]) != null;
    }) ??
    null
  );
}

function looksLikeReservationPayload(outcome: SynthesizerToolOutcome): boolean {
  const p = outcome.structuredPayload ?? tryParseJson(outcome.preview);
  return dig(p, ["checkinDate", "data.checkinDate", "guestsQuantity"]) != null;
}

export function looksLikeRawToolJson(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (/^\s*[\[{]/.test(t) && /"(?:message|data|ok|error|found|checkin)"\s*:/i.test(t)) {
    return true;
  }
  return /"message"\s*:\s*"Check-in realizado/i.test(t);
}

export function buildModeloS9TravelFormTemplate(): string {
  return "";
}

export function buildModeloS9TravelFormTemplateFromToolOutcomes(): string {
  return "";
}

export function replyLooksLikeModeloS9(_text: string): boolean {
  return false;
}

export function buildModeloS4cCompanionOptIn(_partySize: number): string {
  return "";
}

export function buildModeloS10CheckInAck(): string {
  return renderReplyTemplate({ templateId: "reservation_lookup_completed", facts: {} });
}

export function replyLooksLikeCheckInAck(text: string): boolean {
  const t = (text ?? "").trim();
  return !!t && !looksLikeRawToolJson(t) && /check-in\s+foi\s+conclu[ií]do/i.test(t);
}

function userMessageLooksLikePostCompletionFollowUp(userMessage?: string): boolean {
  const msg = (userMessage ?? "").trim();
  return /envie os detalhes da estadia|detalhes da estadia|wi-?fi|endere[cç]o e acessos/i.test(msg);
}

function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const o = payload as Record<string, unknown>;
  if (typeof o.bodyPreview === "string" && o.bodyPreview.trim().startsWith("{")) {
    return tryParseJson(o.bodyPreview) ?? payload;
  }
  return payload;
}

function tryRenderReservationLookup(
  reservation: SynthesizerToolOutcome,
  userMessage?: string,
  promptIr?: PromptIR,
): string | null {
  let payload = unwrapPayload(reservation.structuredPayload ?? tryParseJson(reservation.preview));
  if (!payload) return null;
  const facts = {
    ...factsFromReservationPayload(payload, userMessage),
    ...(promptIr ? templateFactsFromEnrichedIr(promptIr) : { checkinLink: "https://pms.audaar.com.br/checkin/vivapp/access" }),
  };
  const irSpec = matchIrReplyTemplate(promptIr, "after_tool_success", reservation.name);
  const templateId = irSpec
    ? resolveReservationLookupTemplateId(facts)
    : resolveReservationLookupTemplateId(facts);
  const reply = renderReplyTemplate({
    templateId,
    facts,
    userMessage,
    toolOutcomes: [reservation],
  });
  if (reply.trim() && !isNonDeliveringAgentReply(reply)) return reply;
  return null;
}

/**
 * Garante reply substantiva após tools OK — templates do IR via ReplyTemplateRenderer.
 */
export function ensureDeliveringReply(input: EnsureDeliveringReplyInput): EnsureDeliveringReplyResult {
  const successful = input.toolOutcomes.filter((t) => t.ok !== false && t.name !== "buscar_conhecimento");
  const failedAvailability = input.toolOutcomes.some(
    (t) =>
      t.ok === false &&
      /(?:consultar[_-]?)?disponibilidade|availability/i.test(t.name),
  );
  const quoteConfirmTurn = /^(sim|ok|okay|certo|confirmo|yes|pode)$/i.test(
    (input.userMessage ?? "").trim(),
  );

  if (successful.length === 0) {
    if (
      failedAvailability &&
      quoteConfirmTurn &&
      isNonDeliveringAgentReply(input.replyText, input.configuredStallMessages)
    ) {
      return {
        reply:
          "Não consegui consultar a disponibilidade agora. Pode repetir as datas e a propriedade, ou prefere que eu encaminhe para a equipe?",
        replaced: true,
        reason: "quote_availability_failed",
      };
    }
    return { reply: input.replyText, replaced: false };
  }

  const replyIsRawJson = looksLikeRawToolJson(input.replyText);

  const postCompletionTurn = userMessageLooksLikePostCompletionFollowUp(input.userMessage);
  const reservation = findReservationLookupOutcome(successful);
  const checkInTurn = userMessageLooksLikeCheckInTurn(input.userMessage);
  const soleReservationLookup =
    Boolean(reservation) &&
    successful.every((t) => /consultar[_-]?reserva/i.test(t.name) || looksLikeReservationPayload(t));

  if (
    !postCompletionTurn &&
    reservation &&
    (checkInTurn || soleReservationLookup) &&
    !replyLooksLikeModeloS1(input.replyText)
  ) {
    const rendered = tryRenderReservationLookup(reservation, input.userMessage, input.promptIr);
    if (rendered) {
      return { reply: rendered, replaced: true, reason: input.promptIr ? "ir_template" : "reservation_s1" };
    }
  }

  const nonDelivering =
    replyIsRawJson || isNonDeliveringAgentReply(input.replyText, input.configuredStallMessages);
  if (!nonDelivering && hasSubstantiveAgentReplyToCustomer(input.replyText, input.configuredStallMessages)) {
    return { reply: input.replyText, replaced: false };
  }

  if (!postCompletionTurn && reservation) {
    const rendered = tryRenderReservationLookup(reservation, input.userMessage, input.promptIr);
    if (rendered) {
      return { reply: rendered, replaced: true, reason: input.promptIr ? "ir_template" : "reservation_s1" };
    }
  }

  const deterministic = buildDeterministicReplyFromToolOutcomes(successful);
  if (
    deterministic.trim() &&
    !isNonDeliveringAgentReply(deterministic, input.configuredStallMessages)
  ) {
    return { reply: deterministic.trim(), replaced: true, reason: "deterministic_fallback" };
  }

  if (!input.replyText.trim()) {
    return {
      reply: "Consultei o sistema, mas não obtive um resultado útil ainda. Pode repetir o pedido?",
      replaced: true,
      reason: "empty",
    };
  }

  return { reply: input.replyText, replaced: true, reason: "stall" };
}
