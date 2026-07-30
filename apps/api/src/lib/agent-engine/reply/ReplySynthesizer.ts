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
  reason?:
    | "tool_narration"
    | "stall"
    | "empty"
    | "reservation_s1"
    | "embratur_s9"
    | "check_in_ack"
    | "deterministic_fallback";
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
  // Audaar: { data: { reservation, stay, guest } } ou { data: { ...flat } }
  const data = asRecord(root?.data) ?? root;
  const stay = asRecord(data?.stay) ?? asRecord(root?.stay) ?? data;
  const reservation = asRecord(data?.reservation) ?? asRecord(root?.reservation) ?? data;
  const room = asRecord(data?.room) ?? asRecord(stay?.room) ?? null;
  const establishment =
    asRecord(data?.establishment) ??
    asRecord(reservation?.establishment) ??
    asRecord(stay?.establishment) ??
    null;

  const lodging =
    pickString(data, [
      "establishmentName",
      "hotelName",
      "propertyName",
      "establishment.name",
      "hotel.name",
      "stay.establishmentName",
      "room.establishmentName",
      "room.categoryName",
      "categoryName",
    ]) ||
    pickString(stay, ["establishmentName", "hotelName", "categoryName"]) ||
    pickString(reservation, ["establishmentName", "hotelName", "propertyName"]) ||
    pickString(establishment, ["name", "establishmentName"]) ||
    pickString(room, ["establishmentName", "categoryName", "name"]) ||
    "…";

  const checkIn = formatDatePt(
    dig(stay, ["checkinDate", "checkInDate"]) ??
      dig(data, ["checkinDate", "checkInDate", "stay.checkinDate", "reservation.checkinDate"]) ??
      dig(reservation, ["checkinDate", "checkInDate"]),
  );
  const checkOut = formatDatePt(
    dig(stay, ["checkoutDate", "checkOutDate"]) ??
      dig(data, ["checkoutDate", "checkOutDate", "stay.checkoutDate", "reservation.checkoutDate"]) ??
      dig(reservation, ["checkoutDate", "checkOutDate"]),
  );
  const guests =
    pickNumber(stay, ["guestsQuantity", "N"]) ??
    pickNumber(data, ["guestsQuantity", "stay.guestsQuantity", "reservation.guestsQuantity", "N"]) ??
    pickNumber(reservation, ["guestsQuantity", "N"]);
  const locator =
    pickString(data, [
      "uid",
      "locator",
      "localizer",
      "localizador",
      "reservationCode",
      "reference",
      "stay.uid",
      "stay.localizer",
      "reservation.localizer",
      "reservation.uid",
    ]) ||
    pickString(stay, ["uid", "localizer", "localizador"]) ||
    pickString(reservation, ["uid", "localizer", "localizador"]);
  return {
    lodging,
    checkIn,
    checkOut,
    guests,
    locator,
    checkInDone: isCheckInDone(data) || isCheckInDone(stay) || isCheckInDone(reservation),
  };
}

/**
 * Modelo S1 (check-in pendente) — script fixo a partir do JSON da tool.
 * Alinhado a docs/prompt.md (GATE C3).
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
    `Olá! 😊\n` +
    `Encontramos sua reserva com sucesso!\n` +
    `📍 Hospedagem: ${f.lodging}\n` +
    `📅 Check-in: ${checkInLine}\n` +
    `📅 Check-out: ${checkOutLine}\n` +
    `👥 Hóspedes: ${n}\n` +
    `Seu check-in ainda não foi realizado.\n` +
    `✅ Pelo link: 🔗 https://pms.audaar.com.br/checkin/vivapp/access\n` +
    `💬 Por este chat: responda abaixo.\n` +
    `Para começar, informe: você é brasileiro(a) ou estrangeiro(a)?`
  );
}

/** Reply já segue o script S1 / verificar / check-in feito. */
export function replyLooksLikeModeloS1(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const hasFacts =
    /📍\s*Hospedagem|Hospedagem\s*:/i.test(t) &&
    /📅\s*Check-in|Check-in\s*:/i.test(t) &&
    /👥\s*Hóspedes|Hóspedes\s*:/i.test(t);
  if (!hasFacts) return false;

  // Check-in pendente: exigir o script do prompt (link + nacionalidade) — não aceitar paráfrase.
  if (/encontramos\s+sua\s+reserva\s+com\s+sucesso/i.test(t)) {
    return (
      /checkin\/vivapp\/access/i.test(t) &&
      /brasileiro\(a\)\s+ou\s+estrangeiro/i.test(t) &&
      /ainda\s+n[aã]o\s+foi\s+realizado/i.test(t)
    );
  }

  return (
    /encontrei\s+sua\s+reserva/i.test(t) &&
    (/deseja\s+fazer\s+o\s+check-in\s+agora|check-in:\s*já\s+realizado|check-in:\s*pendente/i.test(
      t,
    ) ||
      /pelo\s+link:.*checkin/i.test(t))
  );
}

export function userMessageLooksLikeCheckInTurn(userMessage?: string): boolean {
  const msg = (userMessage ?? "").trim();
  if (!msg) return false;
  if (/\bcheck[- ]?in\b/i.test(msg)) return true;
  if (/\bfazer\s+check\b/i.test(msg)) return true;
  // Localizador + menção a reserva (C3 curto).
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

function looksLikeReservationPayload(outcome: SynthesizerToolOutcome): boolean {
  const p = outcome.structuredPayload ?? tryParseJson(outcome.preview);
  if (!p) return false;
  return dig(p, ["checkinDate", "data.checkinDate", "stay.checkinDate", "guestsQuantity"]) != null;
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
  return bits.join("\n\n").slice(0, 3500);
}

function tryBuildModeloS1(
  reservation: SynthesizerToolOutcome,
  userMessage?: string,
): string | null {
  let payload = reservation.structuredPayload ?? tryParseJson(reservation.preview);
  // Scheduler skip: { ok, bodyPreview: "{...}" } ainda no preview
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const o = payload as Record<string, unknown>;
    if (typeof o.bodyPreview === "string" && o.bodyPreview.trim().startsWith("{")) {
      const inner = tryParseJson(o.bodyPreview);
      if (inner) payload = inner;
    }
  }
  if (!payload) return null;
  const s1 = buildModeloS1FromReservationPayload(payload, { userMessage });
  if (s1.trim() && !isNonDeliveringAgentReply(s1)) return s1;
  return null;
}

/** Template dos 6 (S9) — docs/prompt.md após embratur-reference. */
export function buildModeloS9TravelFormTemplate(): string {
  return (
    `Para finalizar, envie de uma vez as informações da viagem:\n` +
    `1. Qual é o motivo da viagem? (Lazer/Férias, Negócios, Congresso/Feira, Parentes/Amigos, Estudos/Cursos, Religião, Saúde, Compras ou Outro)\n` +
    `2. Qual é o meio de transporte da chegada? (Avião, Automóvel, Ônibus, Moto, Trem, Van, Bicicleta, Caminhada ou Outro)\n` +
    `3. Qual é o país de residência permanente? Exemplo: Brasil\n` +
    `4. Qual é o país de destino? Exemplo: Brasil\n` +
    `5. Qual é a cidade de procedência? Exemplo: São Paulo\n` +
    `6. Qual é a cidade de destino? Exemplo: Rio de Janeiro\n` +
    `Pode responder em uma única mensagem.`
  );
}

export function replyLooksLikeModeloS9(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /motivo\s+da\s+viagem/i.test(t) &&
    /meio\s+de\s+transporte/i.test(t) &&
    /pa[ií]s\s+de\s+resid/i.test(t) &&
    /cidade\s+de\s+(?:proced|destino)/i.test(t)
  );
}

/** Ack S10 após audaar_check_in HTTP 200. */
export function buildModeloS10CheckInAck(): string {
  return "Seu check-in foi concluído com sucesso! Em seguida envio Wi-Fi, endereço e acessos da estadia.";
}

export function replyLooksLikeCheckInAck(text: string): boolean {
  return /check-in\s+foi\s+conclu[ií]do/i.test((text ?? "").trim());
}

/**
 * Garante reply substantiva apos tools OK.
 * C3 → Modelo S1 · S9 embratur → template dos 6 · S10 check_in → ack.
 */
export function ensureDeliveringReply(input: EnsureDeliveringReplyInput): EnsureDeliveringReplyResult {
  const successful = input.toolOutcomes.filter((t) => t.ok !== false && t.name !== "buscar_conhecimento");
  if (successful.length === 0) {
    return { reply: input.replyText, replaced: false };
  }

  const hasCompletionTool = successful.some(
    (t) => /check[_-]?in/i.test(t.name) && !/consultar/i.test(t.name),
  );
  const hasEmbraturGate = successful.some((t) => /embratur[-_]?reference/i.test(t.name));

  if (hasCompletionTool && !replyLooksLikeCheckInAck(input.replyText)) {
    return { reply: buildModeloS10CheckInAck(), replaced: true, reason: "check_in_ack" };
  }

  if (hasEmbraturGate && !hasCompletionTool && !replyLooksLikeModeloS9(input.replyText)) {
    return { reply: buildModeloS9TravelFormTemplate(), replaced: true, reason: "embratur_s9" };
  }

  const reservation = findReservationLookupOutcome(successful);
  const checkInTurn = userMessageLooksLikeCheckInTurn(input.userMessage);
  const soleReservationLookup =
    Boolean(reservation) &&
    successful.every(
      (t) => /consultar[_-]?reserva/i.test(t.name) || looksLikeReservationPayload(t),
    );

  if (
    !hasCompletionTool &&
    !hasEmbraturGate &&
    reservation &&
    (checkInTurn || soleReservationLookup) &&
    !replyLooksLikeModeloS1(input.replyText)
  ) {
    const s1 = tryBuildModeloS1(reservation, input.userMessage);
    if (s1) {
      return { reply: s1, replaced: true, reason: "reservation_s1" };
    }
  }

  const nonDelivering = isNonDeliveringAgentReply(
    input.replyText,
    input.configuredStallMessages,
  );
  if (!nonDelivering && hasSubstantiveAgentReplyToCustomer(input.replyText, input.configuredStallMessages)) {
    return { reply: input.replyText, replaced: false };
  }

  if (!hasCompletionTool && !hasEmbraturGate && reservation) {
    const s1 = tryBuildModeloS1(reservation, input.userMessage);
    if (s1) {
      return { reply: s1, replaced: true, reason: "reservation_s1" };
    }
  }

  const fallback = deterministicFallbackFromTools(successful);
  return {
    reply: fallback,
    replaced: true,
    reason: input.replyText.trim() ? "stall" : "empty",
  };
}
