import {
  hasSubstantiveAgentReplyToCustomer,
  isNonDeliveringAgentReply,
} from "./ReplyQuality.js";

export type SynthesizerToolOutcome = {
  name: string;
  ok: boolean;
  preview: string;
  structuredPayload?: unknown;
};

export type EnsureDeliveringReplyInput = {
  replyText: string;
  toolOutcomes: SynthesizerToolOutcome[];
  userMessage?: string;
  configuredStallMessages?: string[];
};

export type EnsureDeliveringReplyResult = {
  reply: string;
  replaced: boolean;
  reason?: "tool_narration" | "stall" | "empty" | "reservation_s1" | "deterministic_fallback";
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
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
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

function isCheckInDone(payload: unknown): boolean {
  const status = dig(payload, [
    "checkinActionDate",
    "data.checkinActionDate",
    "stay.checkinActionDate",
    "reservation.checkinActionDate",
  ]);
  if (status != null && String(status).trim()) return true;
  const flag = dig(payload, ["checkInDone", "data.checkInDone", "stay.checkInCompleted"]);
  return flag === true || flag === "true";
}

/** Extrai campos tipicos de consultar_reserva (Audaar / generico). */
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
  const lodging =
    pickString(data, [
      "establishmentName",
      "hotelName",
      "propertyName",
      "establishment.name",
      "hotel.name",
      "stay.establishmentName",
      "room.establishmentName",
    ]) || "…";
  const checkIn = formatDatePt(
    dig(data, ["checkinDate", "checkInDate", "stay.checkinDate", "reservation.checkinDate"]),
  );
  const checkOut = formatDatePt(
    dig(data, ["checkoutDate", "checkOutDate", "stay.checkoutDate", "reservation.checkoutDate"]),
  );
  const guests = pickNumber(data, [
    "guestsQuantity",
    "stay.guestsQuantity",
    "reservation.guestsQuantity",
    "N",
  ]);
  const locator = pickString(data, [
    "uid",
    "locator",
    "localizador",
    "reservationCode",
    "reference",
    "stay.uid",
  ]);
  return {
    lodging,
    checkIn,
    checkOut,
    guests,
    locator,
    checkInDone: isCheckInDone(data),
  };
}

/**
 * Modelo S1 (check-in pendente) — script fixo a partir do JSON da tool.
 * Usado quando o LLM narra «Invocando ferramenta» em vez de entregar factos.
 */
export function buildModeloS1FromReservationPayload(
  payload: unknown,
  opts?: { userMessage?: string },
): string {
  const f = extractReservationDisplayFields(payload);
  const n = f.guests != null ? String(f.guests) : "…";
  const checkInLine =
    f.checkIn !== "…" ? `${f.checkIn}, a partir das 14:00h` : "…";
  const checkOutLine = f.checkOut !== "…" ? `${f.checkOut}, até as 12:00h` : "…";

  if (f.checkInDone) {
    return (
      `Encontrei sua reserva${f.locator ? ` ${f.locator}` : ""}:\n` +
      `📍 Hospedagem: ${f.lodging}\n` +
      `📅 Check-in: ${checkInLine}\n` +
      `📅 Check-out: ${checkOutLine}\n` +
      `👥 Hóspedes: ${n}\n` +
      `✅ Check-in: já realizado\n` +
      `Posso ajudar com mais alguma coisa?`
    );
  }

  const wantsVerify =
    /\b(verificar|consultar)\b/i.test(opts?.userMessage ?? "") &&
    !/\bcheck[- ]?in\b/i.test(opts?.userMessage ?? "");
  if (wantsVerify) {
    return (
      `Encontrei sua reserva${f.locator ? ` ${f.locator}` : ""}:\n` +
      `📍 Hospedagem: ${f.lodging}\n` +
      `📅 Check-in: ${checkInLine}\n` +
      `📅 Check-out: ${checkOutLine}\n` +
      `👥 Hóspedes: ${n}\n` +
      `⏳ Check-in: pendente\n` +
      `Deseja fazer o check-in agora por este chat? (Sim/Não)`
    );
  }

  return (
    `Encontrei sua reserva com sucesso!\n\n` +
    `📍 Hospedagem: ${f.lodging}\n` +
    `📅 Check-in: ${checkInLine}\n` +
    `📅 Check-out: ${checkOutLine}\n` +
    `👥 Hóspedes: ${n}\n` +
    `Seu check-in ainda não foi realizado.\n\n` +
    `✅ Pelo link: 🔗 https://pms.audaar.com.br/checkin/vivapp/access\n` +
    `💬 Por este chat: responda abaixo.\n` +
    `Para começar, informe: você é brasileiro(a) ou estrangeiro(a)?`
  );
}

function findReservationLookupOutcome(
  outcomes: SynthesizerToolOutcome[],
): SynthesizerToolOutcome | null {
  const ok = outcomes.filter((t) => t.ok !== false);
  return (
    ok.find((t) => /consultar[_-]?reserva/i.test(t.name)) ??
    ok.find((t) => {
      const p = t.structuredPayload ?? tryParseJson(t.preview);
      if (!p) return false;
      return dig(p, ["checkinDate", "data.checkinDate", "stay.checkinDate", "guestsQuantity"]) != null;
    }) ??
    null
  );
}

function tryParseJson(preview: string): unknown {
  try {
    return JSON.parse(preview);
  } catch {
    return null;
  }
}

function deterministicFallbackFromTools(outcomes: SynthesizerToolOutcome[]): string {
  const ok = outcomes.filter((t) => t.ok && t.name !== "buscar_conhecimento");
  if (ok.length === 0) {
    return "Consultei o sistema, mas não obtive um resultado útil ainda. Pode repetir o pedido?";
  }
  const bits: string[] = [];
  for (const t of ok.slice(0, 2)) {
    const payload = t.structuredPayload ?? tryParseJson(t.preview);
    if (payload) {
      const f = extractReservationDisplayFields(payload);
      if (f.guests != null || f.checkIn !== "…") {
        bits.push(
          `Consulta ${t.name}: check-in ${f.checkIn}, check-out ${f.checkOut}, hóspedes ${f.guests ?? "…"}.`,
        );
        continue;
      }
    }
    const preview = t.preview.replace(/\s+/g, " ").slice(0, 280);
    if (preview && !/invocando|consultando a reserva/i.test(preview)) {
      bits.push(preview);
    }
  }
  if (bits.length === 0) {
    return (
      "Já consultei o sistema com base no seu pedido. " +
      "Pode confirmar o próximo passo ou partilhar mais algum detalhe?"
    );
  }
  return bits.join("\n\n");
}

/**
 * Garante reply substantiva apos tools OK.
 * Descarta stall / narracao de invocacao e substitui por Modelo S1 ou fallback.
 */
export function ensureDeliveringReply(input: EnsureDeliveringReplyInput): EnsureDeliveringReplyResult {
  const successful = input.toolOutcomes.filter((t) => t.ok !== false && t.name !== "buscar_conhecimento");
  if (successful.length === 0) {
    return { reply: input.replyText, replaced: false };
  }

  const nonDelivering = isNonDeliveringAgentReply(
    input.replyText,
    input.configuredStallMessages,
  );
  if (!nonDelivering && hasSubstantiveAgentReplyToCustomer(input.replyText, input.configuredStallMessages)) {
    return { reply: input.replyText, replaced: false };
  }

  const reservation = findReservationLookupOutcome(successful);
  if (reservation) {
    const payload = reservation.structuredPayload ?? tryParseJson(reservation.preview);
    if (payload) {
      const s1 = buildModeloS1FromReservationPayload(payload, {
        userMessage: input.userMessage,
      });
      if (s1.trim() && !isNonDeliveringAgentReply(s1)) {
        return { reply: s1, replaced: true, reason: "reservation_s1" };
      }
    }
  }

  const fallback = deterministicFallbackFromTools(successful);
  return {
    reply: fallback,
    replaced: true,
    reason: input.replyText.trim() ? "stall" : "empty",
  };
}
