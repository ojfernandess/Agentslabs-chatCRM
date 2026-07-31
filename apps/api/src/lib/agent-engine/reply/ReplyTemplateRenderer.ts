/**
 * Fase 6 — Interpolação genérica de templates de resposta a partir de facts/tool outcomes.
 */
import type { ReplyTemplateSpec } from "../contract/CompletionTypes.js";
import type { PromptIR } from "../contract/PromptIR.js";
import {
  buildModeloS9TemplateFromCatalog,
  parseEmbraturReferenceCatalog,
} from "../checkin/embraturReferenceCatalog.js";

export type SynthesizerToolOutcome = {
  name: string;
  ok: boolean;
  preview: string;
  structuredPayload?: unknown;
};

export type RenderReplyTemplateOpts = {
  templateId: string;
  facts: Record<string, string | number | boolean | null | undefined>;
  userMessage?: string;
  toolOutcomes?: SynthesizerToolOutcome[];
  bodyOverride?: string;
};

export const REPLY_TEMPLATE_BODIES: Record<string, string> = {
  reservation_lookup_checkin:
    "Olá! 😊\nEncontramos sua reserva com sucesso!\n" +
    "📍 Hospedagem: {{facts.lodging}}\n" +
    "📅 Check-in: {{facts.checkInLine}}\n" +
    "📅 Check-out: {{facts.checkOutLine}}\n" +
    "👥 Hóspedes: {{facts.guests}}\n" +
    "Seu check-in ainda não foi realizado.\n" +
    "✅ Pelo link: 🔗 {{facts.checkinLink}}\n" +
    "💬 Por este chat: responda abaixo.\n" +
    "Para começar, informe: você é brasileiro(a) ou estrangeiro(a)?",
  reservation_lookup_verify:
    "Encontrei sua reserva{{facts.locatorSuffix}}:\n" +
    "📍 Hospedagem: {{facts.lodging}}\n" +
    "📅 Check-in: {{facts.checkInLine}}\n" +
    "📅 Check-out: {{facts.checkOutLine}}\n" +
    "👥 Hóspedes: {{facts.guests}}\n" +
    "⏳ Check-in: pendente\n" +
    "Deseja fazer o check-in agora por este chat? (Sim/Não)",
  reservation_lookup_done:
    "Encontrei sua reserva{{facts.locatorSuffix}}:\n" +
    "📍 Hospedagem: {{facts.lodging}}\n" +
    "📅 Check-in: {{facts.checkInLine}}\n" +
    "📅 Check-out: {{facts.checkOutLine}}\n" +
    "👥 Hóspedes: {{facts.guests}}\n" +
    "✅ Check-in: já realizado\n" +
    "Posso ajudar com mais alguma coisa?",
  check_in_completion_ack:
    "Seu check-in foi concluído com sucesso! Em seguida envio Wi-Fi, endereço e acessos da estadia.",
  travel_form_prompt:
    "Para finalizar, envie de uma vez as informações da viagem:\n" +
    "1. Qual é o motivo da viagem?\n" +
    "2. Qual é o meio de transporte da chegada?\n" +
    "3. Qual é o país de residência permanente?\n" +
    "4. Qual é o país de destino?\n" +
    "5. Qual é a cidade de procedência?\n" +
    "6. Qual é a cidade de destino?\n" +
    "Pode responder em uma única mensagem.",
  companion_opt_in:
    "Sua reserva é para {{facts.partySize}} hóspedes no total (você + {{facts.companions}} acompanhante(s)). " +
    "Deseja cadastrar o(s) acompanhante(s) agora? (Sim/Não)",
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function dig(obj: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const parts = path.split(".");
    let cur: unknown = obj;
    let ok = true;
    for (const p of parts) {
      const rec = asRecord(cur);
      if (!rec || !(p in rec)) {
        ok = false;
        break;
      }
      cur = rec[p];
    }
    if (ok && cur != null && cur !== "") return cur;
  }
  return undefined;
}

function formatDatePt(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "…";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw.trim();
}

function pickString(payload: unknown, paths: string[]): string {
  const v = dig(payload, paths);
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function pickNumber(payload: unknown, paths: string[]): number | null {
  const v = dig(payload, paths);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function truthyFlag(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function isCheckInDone(payload: unknown): boolean {
  const flag = dig(payload, ["checkInDone", "data.checkInDone", "validatedCheckin", "hasCheckinApproved"]);
  if (truthyFlag(flag)) return true;
  const status = dig(payload, ["checkinActionDate", "data.checkinActionDate"]);
  return status != null && String(status).trim() !== "" && String(status) !== "null";
}

export function extractReservationDisplayFields(payload: unknown): {
  lodging: string;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  locator: string;
  checkInDone: boolean;
} {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const stay = asRecord(data?.stay) ?? asRecord(root?.stay) ?? data;
  const reservation = asRecord(data?.reservation) ?? asRecord(root?.reservation) ?? data;
  const establishment =
    asRecord(data?.establishment) ??
    asRecord(stay?.establishment) ??
    asRecord(reservation?.establishment) ??
    null;
  const lodging =
    pickString(data, ["establishmentName", "hotelName", "propertyName"]) ||
    pickString(stay, ["establishmentName", "hotelName", "categoryName"]) ||
    pickString(reservation, ["establishmentName", "hotelName"]) ||
    pickString(establishment, ["name", "establishmentName"]) ||
    "…";
  const checkIn = formatDatePt(
    dig(stay, ["checkinDate", "checkInDate"]) ??
      dig(data, ["checkinDate", "checkInDate", "stay.checkinDate"]) ??
      dig(reservation, ["checkinDate"]),
  );
  const checkOut = formatDatePt(
    dig(stay, ["checkoutDate", "checkOutDate"]) ??
      dig(data, ["checkoutDate", "checkOutDate", "stay.checkoutDate"]) ??
      dig(reservation, ["checkoutDate"]),
  );
  const guests =
    pickNumber(stay, ["guestsQuantity", "N"]) ??
    pickNumber(data, ["guestsQuantity", "stay.guestsQuantity", "N"]) ??
    pickNumber(reservation, ["guestsQuantity"]);
  const locator =
    pickString(data, ["uid", "locator", "localizador", "localizer"]) ||
    pickString(stay, ["uid", "localizer", "localizador"]) ||
    pickString(reservation, ["uid", "localizer"]);
  return {
    lodging,
    checkIn,
    checkOut,
    guests,
    locator,
    checkInDone: isCheckInDone(data) || isCheckInDone(stay) || isCheckInDone(reservation),
  };
}

export function factsFromReservationPayload(
  payload: unknown,
  userMessage?: string,
): Record<string, string | number | boolean | null | undefined> {
  const f = extractReservationDisplayFields(payload);
  const wantsVerify =
    /\b(verificar|consultar)\b/i.test(userMessage ?? "") &&
    !/\bcheck[- ]?in\b/i.test(userMessage ?? "");
  return {
    lodging: f.lodging,
    checkInLine: f.checkIn !== "…" ? `${f.checkIn}, a partir das 14:00h` : "…",
    checkOutLine: f.checkOut !== "…" ? `${f.checkOut}, até as 12:00h` : "…",
    guests: f.guests != null ? String(f.guests) : "…",
    locatorSuffix: f.locator ? ` ${f.locator}` : "",
    checkInDone: f.checkInDone,
    wantsVerify,
    partySize: f.guests ?? 2,
    companions: f.guests != null ? Math.max(0, f.guests - 1) : 1,
  };
}

export function interpolateTemplateBody(
  body: string,
  facts: Record<string, string | number | boolean | null | undefined>,
): string {
  return body.replace(/\{\{facts\.([a-zA-Z0-9_]+)\}\}/g, (_m, key: string) => {
    const v = facts[key];
    if (v === undefined || v === null) return "…";
    return String(v);
  });
}

export function renderReplyTemplate(opts: RenderReplyTemplateOpts): string {
  if (opts.templateId === "travel_form_prompt" && opts.toolOutcomes?.length) {
    for (const t of opts.toolOutcomes) {
      if (t.ok === false || !/embratur[-_]?reference/i.test(t.name)) continue;
      let catalog = parseEmbraturReferenceCatalog(t.structuredPayload);
      if (
        (catalog.motivos.length === 0 || catalog.transportes.length === 0) &&
        typeof t.preview === "string" &&
        t.preview.trim().startsWith("{")
      ) {
        try {
          catalog = parseEmbraturReferenceCatalog(JSON.parse(t.preview));
        } catch {
          /* ignore */
        }
      }
      const fromCatalog = buildModeloS9TemplateFromCatalog(catalog);
      if (fromCatalog) return fromCatalog;
    }
  }
  const body = opts.bodyOverride ?? REPLY_TEMPLATE_BODIES[opts.templateId] ?? "";
  return interpolateTemplateBody(body, opts.facts);
}

export function resolveReservationLookupTemplateId(
  facts: ReturnType<typeof factsFromReservationPayload>,
): string {
  if (facts.checkInDone) return "reservation_lookup_done";
  if (facts.wantsVerify) return "reservation_lookup_verify";
  return "reservation_lookup_checkin";
}

export function irTemplateToBodyId(spec: ReplyTemplateSpec): string {
  const label = spec.label.toLowerCase();
  if (/^s1$/i.test(spec.label) || spec.bindToolPattern === "consultar_reserva") {
    return "reservation_lookup_checkin";
  }
  if (/^s9$/i.test(label)) return "travel_form_prompt";
  if (/^s10$/i.test(label)) return "check_in_completion_ack";
  if (/^s4c$/i.test(label)) return "companion_opt_in";
  if (spec.trigger === "on_completion") return "check_in_completion_ack";
  return spec.id;
}

export function matchIrReplyTemplate(
  promptIr: PromptIR | undefined,
  trigger: ReplyTemplateSpec["trigger"],
  toolName?: string,
): ReplyTemplateSpec | undefined {
  if (!promptIr?.replyTemplates.length) return undefined;
  return promptIr.replyTemplates.find((t) => {
    if (t.trigger !== trigger) return false;
    if (t.bindToolPattern && toolName) {
      const escaped = t.bindToolPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(escaped, "i").test(toolName);
    }
    return !t.bindToolPattern;
  });
}
