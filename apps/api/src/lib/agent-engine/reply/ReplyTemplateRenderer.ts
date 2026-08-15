/**
 * Fase 6 — Interpolação genérica de templates de resposta a partir de facts/tool outcomes.
 */
import { extractReservationReferenceFromMessage } from "../../knowledgeQueryEnrichment.js";
import { resolveCheckinLink } from "./checkinLink.js";
import type { ReplyTemplateSpec } from "../contract/CompletionTypes.js";
import type { PromptIR } from "../contract/PromptIR.js";

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
    "Seu check-in ainda não foi realizado.\n\n" +
    "É simples e rápido — acesse o link abaixo, confirme o localizador e preencha as etapas na tela:\n\n" +
    "🔗 {{facts.checkinLink}}\n\n" +
    "1️⃣ Abra o link no celular ou computador.\n" +
    "2️⃣ Confirme ou digite o localizador da reserva (**{{facts.locator}}**).\n" +
    "3️⃣ Preencha as etapas que aparecerem — ao final, você verá o **número da suíte** e a **senha** ou **forma de acesso**.\n\n" +
    "Se tiver dúvidas durante o processo, estou por aqui! 😊",
  reservation_lookup_verify:
    "Encontrei sua reserva{{facts.locatorSuffix}}:\n" +
    "📍 Hospedagem: {{facts.lodging}}\n" +
    "📅 Check-in: {{facts.checkInLine}}\n" +
    "📅 Check-out: {{facts.checkOutLine}}\n" +
    "👥 Hóspedes: {{facts.guests}}\n" +
    "⏳ Check-in: pendente\n\n" +
    "Para fazer o check-in agora, acesse: 🔗 {{facts.checkinLink}}\n" +
    "Abra o link, confirme o localizador e preencha as etapas na tela — é simples e rápido.\n" +
    "Posso ajudar com mais alguma coisa?",
  reservation_lookup_done:
    "Encontrei sua reserva{{facts.locatorSuffix}}:\n" +
    "📍 Hospedagem: {{facts.lodging}}\n" +
    "📅 Check-in: {{facts.checkInLine}}\n" +
    "📅 Check-out: {{facts.checkOutLine}}\n" +
    "👥 Hóspedes: {{facts.guests}}\n" +
    "✅ Check-in: já realizado\n" +
    "🛏️ Quarto: {{facts.roomLabel}}\n" +
    "🔑 Senha: {{facts.roomPassword}}\n" +
    "Posso ajudar com mais alguma coisa?",
  reservation_lookup_completed:
    "Seu check-in foi concluído com sucesso! Veja abaixo os dados da sua reserva:\n\n" +
    "—\n" +
    "🏨 Nome da hospedagem: {{facts.lodging}}\n" +
    "🔢 Número da reserva: {{facts.locator}}\n" +
    "🛏️ Quarto: {{facts.roomLabel}}\n" +
    "📅 Período: {{facts.checkIn}} a {{facts.checkOut}}\n" +
    "⏰ Check-in: a partir das {{facts.checkInTime}}\n" +
    "⏰ Checkout: até {{facts.checkOutTime}}\n" +
    "🔑 Senha da porta: {{facts.roomPassword}}\n" +
    "—\n\n" +
    "Se precisar de endereço, Wi-Fi ou procedimento de entrada, é só me avisar!",
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

/**
 * Audaar / consultar_reserva: check-in realizado se qualquer flag de status estiver true.
 * Alinha com o prompt (checkinApi | validatedCheckin | hasCheckinApproved | checkin).
 * Não misturar o path `checkin` (pode ser objeto) com flags escalares no mesmo dig().
 */
function isCheckInDone(payload: unknown): boolean {
  const flag = dig(payload, [
    "checkInDone",
    "data.checkInDone",
    "checkinApi",
    "data.checkinApi",
    "validatedCheckin",
    "data.validatedCheckin",
    "hasCheckinApproved",
    "data.hasCheckinApproved",
    "checkin.validatedCheckin",
    "data.checkin.validatedCheckin",
    "checkin.hasCheckinApproved",
    "data.checkin.hasCheckinApproved",
    "checkin.checkInDone",
    "data.checkin.checkInDone",
    "checkin.checkinApi",
    "data.checkin.checkinApi",
  ]);
  if (truthyFlag(flag)) return true;
  // Flag escalar `checkin: 1` (quando não é o objeto aninhado da API).
  const checkinScalar = dig(payload, ["checkin", "data.checkin"]);
  if (truthyFlag(checkinScalar)) return true;
  const status = dig(payload, [
    "checkinActionDate",
    "data.checkinActionDate",
    "checkin.checkinActionDate",
    "data.checkin.checkinActionDate",
  ]);
  return status != null && String(status).trim() !== "" && String(status) !== "null";
}

export function extractReservationDisplayFields(payload: unknown): {
  lodging: string;
  checkIn: string;
  checkOut: string;
  guests: number | null;
  locator: string;
  checkInDone: boolean;
  roomLabel: string;
  roomPassword: string;
  checkInTime: string;
  checkOutTime: string;
} {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const stay = asRecord(data?.stay) ?? asRecord(root?.stay) ?? data;
  const reservation = asRecord(data?.reservation) ?? asRecord(root?.reservation) ?? data;
  const room = asRecord(data?.room) ?? asRecord(stay?.room) ?? asRecord(reservation?.room) ?? null;
  const access = asRecord(data?.access) ?? asRecord(stay?.access) ?? null;
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
    pickString(data, [
      "localizer",
      "localizador",
      "locator",
      "referenceCode",
      "confirmationCode",
      "reservationCode",
    ]) ||
    pickString(stay, ["localizer", "localizador", "locator", "referenceCode"]) ||
    pickString(reservation, ["localizer", "localizador", "referenceCode", "confirmationCode"]) ||
    pickString(data, ["uid"]);
  const roomName =
    pickString(room, ["categoryName", "roomName", "name"]) ||
    pickString(data, ["roomName", "categoryName"]);
  const roomNumber = pickString(room, ["roomNumber", "number"]);
  const roomLabel =
    [roomName, roomNumber].filter(Boolean).join(" — ") ||
    roomNumber ||
    roomName ||
    "…";
  const rawPassword =
    pickString(access, ["roomPassword", "password"]) ||
    pickString(data, ["roomPassword", "access.roomPassword"]);
  const roomPassword = rawPassword || "será disponibilizada em breve";
  const checkInTime =
    pickString(stay, ["checkinTime", "checkInTime"]) ||
    pickString(data, ["checkinTime", "checkInTime"]) ||
    "14:00";
  const checkOutTime =
    pickString(stay, ["checkoutTime", "checkOutTime"]) ||
    pickString(data, ["checkoutTime", "checkOutTime"]) ||
    "12:00";
  const checkinNode =
    asRecord(data?.checkin) ?? asRecord(stay?.checkin) ?? asRecord(reservation?.checkin) ?? asRecord(root?.checkin);
  return {
    lodging,
    checkIn,
    checkOut,
    guests,
    locator,
    checkInDone:
      isCheckInDone(root) ||
      isCheckInDone(data) ||
      isCheckInDone(stay) ||
      isCheckInDone(reservation) ||
      isCheckInDone(checkinNode),
    roomLabel,
    roomPassword,
    checkInTime,
    checkOutTime,
  };
}

export function factsFromReservationPayload(
  payload: unknown,
  userMessage?: string,
): Record<string, string | number | boolean | null | undefined> {
  const f = extractReservationDisplayFields(payload);
  const locatorFromUser = extractReservationReferenceFromMessage(userMessage ?? "");
  const displayLocator = locatorFromUser || f.locator || "…";
  const wantsVerify =
    /\b(verificar|consultar|confirmar|tudo\s+cert[oa]|status)\b/i.test(userMessage ?? "") ||
    (/\breserva\b/i.test(userMessage ?? "") &&
      /\b(confirmad[ao]|cert[oa])\b/i.test(userMessage ?? "") &&
      !/\bcheck[- ]?in\b/i.test(userMessage ?? ""));
  const wantsCheckIn = /\bcheck[- ]?in\b/i.test(userMessage ?? "") || /\bfazer\s+check\b/i.test(userMessage ?? "");
  return {
    lodging: f.lodging,
    checkIn: f.checkIn,
    checkOut: f.checkOut,
    checkInLine: f.checkIn !== "…" ? `${f.checkIn}, a partir das ${f.checkInTime}h` : "…",
    checkOutLine: f.checkOut !== "…" ? `${f.checkOut}, até as ${f.checkOutTime}h` : "…",
    checkInTime: f.checkInTime,
    checkOutTime: f.checkOutTime,
    guests: f.guests != null ? String(f.guests) : "…",
    locator: displayLocator,
    locatorSuffix: displayLocator !== "…" ? ` ${displayLocator}` : "",
    roomLabel: f.roomLabel,
    roomPassword: f.roomPassword,
    checkInDone: f.checkInDone,
    wantsVerify,
    wantsCheckIn,
    checkinLink: resolveCheckinLink({
      locator: displayLocator !== "…" ? String(displayLocator) : null,
    }),
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
  const body = opts.bodyOverride ?? REPLY_TEMPLATE_BODIES[opts.templateId] ?? "";
  return interpolateTemplateBody(body, opts.facts);
}

export function resolveReservationLookupTemplateId(
  facts: ReturnType<typeof factsFromReservationPayload>,
): string {
  if (facts.checkInDone) {
    if (facts.wantsCheckIn && !facts.wantsVerify) return "reservation_lookup_completed";
    return "reservation_lookup_done";
  }
  if (facts.wantsVerify) return "reservation_lookup_verify";
  return "reservation_lookup_checkin";
}

export function irTemplateToBodyId(spec: ReplyTemplateSpec): string {
  const label = spec.label.toLowerCase();
  if (/^s1$/i.test(spec.label) || spec.bindToolPattern === "consultar_reserva") {
    return "reservation_lookup_checkin";
  }
  if (spec.trigger === "on_completion") return "reservation_lookup_completed";
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
