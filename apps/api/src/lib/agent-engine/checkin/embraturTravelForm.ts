/**
 * Mapeia a ficha de viagem (S9b) → payload Embratur do audaar_check_in.
 * IDs alinhados a docs/prompt.md (tabela «ids Embratur — SOMENTE no S10»).
 */

export type EmbraturCheckInFields = {
  snmotvia: number;
  sntiptran: number;
  bgstdscpais: string;
  bgstdscpaisdest: string;
  snidcidadeibge: number;
  snidcidadeibgedest: number;
};

const MOTIVO_RULES: Array<{ re: RegExp; id: number }> = [
  { re: /congresso|feira/i, id: 3 },
  { re: /lazer|f[eé]rias/i, id: 1 },
  { re: /neg[oó]cios/i, id: 2 },
  { re: /parentes|amigos/i, id: 4 },
  { re: /estudos|cursos/i, id: 5 },
  { re: /religi[aã]o/i, id: 6 },
  { re: /sa[uú]de/i, id: 7 },
  { re: /compras/i, id: 8 },
  { re: /outro/i, id: 9 },
];

const TRANSPORTE_RULES: Array<{ re: RegExp; id: number }> = [
  { re: /avi[aã]o/i, id: 1 },
  { re: /autom[oó]vel|carro|auto\b/i, id: 2 },
  { re: /[oô]nibus|bus\b/i, id: 3 },
  { re: /moto/i, id: 4 },
  { re: /trem/i, id: 5 },
  { re: /\bvan\b/i, id: 6 },
  { re: /bicicleta|bike/i, id: 7 },
  { re: /caminhada|a\s+p[eé]/i, id: 8 },
  { re: /outro/i, id: 9 },
];

/** Cidades frequentes no fluxo Auda (IBGE). */
const CITY_IBGE: Array<{ re: RegExp; id: number; label: string }> = [
  { re: /^s[aã]o\s+paulo$/i, id: 3550308, label: "São Paulo" },
  { re: /^rio\s+de\s+janeiro$/i, id: 3304557, label: "Rio de Janeiro" },
];

function normalizeCity(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickId(text: string, rules: Array<{ re: RegExp; id: number }>): number | null {
  const t = text.trim();
  if (!t) return null;
  for (const r of rules) {
    if (r.re.test(t)) return r.id;
  }
  return null;
}

function pickCityIbge(text: string): number | null {
  const t = normalizeCity(text);
  if (!t) return null;
  for (const c of CITY_IBGE) {
    if (c.re.test(t)) return c.id;
  }
  // Match parcial (ex.: "São Paulo - SP")
  for (const c of CITY_IBGE) {
    if (c.re.test(t.split(/[-–,]/)[0]?.trim() ?? "")) return c.id;
  }
  return null;
}

function extractLabeledField(msg: string, labels: RegExp): string {
  const m = msg.match(labels);
  if (!m?.[1]) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

/** Extrai textos da ficha (Motivo / Transporte / países / cidades). */
export function parseTravelFormFields(userMessage: string): {
  motivo: string;
  transporte: string;
  paisResidencia: string;
  paisDestino: string;
  cidadeProcedencia: string;
  cidadeDestino: string;
} {
  const msg = (userMessage ?? "").trim();
  return {
    motivo: extractLabeledField(
      msg,
      /(?:motivo(?:\s+da\s+viagem)?)\s*[:：]\s*([^\n*]+)/i,
    ),
    transporte: extractLabeledField(
      msg,
      /(?:meio\s+de\s+transporte(?:\s+da\s+chegada)?|transporte)\s*[:：]\s*([^\n*]+)/i,
    ),
    paisResidencia: extractLabeledField(
      msg,
      /(?:pa[ií]s\s+de\s+resid(?:[eê]ncia)?(?:\s+permanente)?)\s*[:：]\s*([^\n*]+)/i,
    ),
    paisDestino: extractLabeledField(
      msg,
      /(?:pa[ií]s\s+de\s+destino)\s*[:：]\s*([^\n*]+)/i,
    ),
    cidadeProcedencia: extractLabeledField(
      msg,
      /(?:cidade\s+de\s+proced[eê]ncia)\s*[:：]\s*([^\n*]+)/i,
    ),
    cidadeDestino: extractLabeledField(
      msg,
      /(?:cidade\s+de\s+destino)\s*[:：]\s*([^\n*]+)/i,
    ),
  };
}

/**
 * Converte texto da ficha → campos Embratur do schema HTTP.
 * Retorna null se faltar algum campo obrigatório mapeável.
 */
export function mapTravelFormToEmbraturFields(
  userMessage: string,
): EmbraturCheckInFields | null {
  const f = parseTravelFormFields(userMessage);
  const snmotvia = pickId(f.motivo, MOTIVO_RULES);
  const sntiptran = pickId(f.transporte, TRANSPORTE_RULES);
  const snidcidadeibge = pickCityIbge(f.cidadeProcedencia);
  const snidcidadeibgedest = pickCityIbge(f.cidadeDestino);
  const bgstdscpais = f.paisResidencia.trim();
  const bgstdscpaisdest = f.paisDestino.trim();
  if (
    snmotvia == null ||
    sntiptran == null ||
    !bgstdscpais ||
    !bgstdscpaisdest ||
    snidcidadeibge == null ||
    snidcidadeibgedest == null
  ) {
    return null;
  }
  return {
    snmotvia,
    sntiptran,
    bgstdscpais,
    bgstdscpaisdest,
    snidcidadeibge,
    snidcidadeibgedest,
  };
}

/** Flat slots para flowSlots / FactStore (auto-fill nested embratur.*). */
export function embraturFieldsToFlowSlots(
  fields: EmbraturCheckInFields,
): Record<string, string | number | boolean> {
  return {
    snmotvia: fields.snmotvia,
    sntiptran: fields.sntiptran,
    bgstdscpais: fields.bgstdscpais,
    bgstdscpaisdest: fields.bgstdscpaisdest,
    snidcidadeibge: fields.snidcidadeibge,
    snidcidadeibgedest: fields.snidcidadeibgedest,
    // Espelho nested útil para argDefaults / sampleContext.
    "embratur.snmotvia": fields.snmotvia,
    "embratur.sntiptran": fields.sntiptran,
    "embratur.bgstdscpais": fields.bgstdscpais,
    "embratur.bgstdscpaisdest": fields.bgstdscpaisdest,
    "embratur.snidcidadeibge": fields.snidcidadeibge,
    "embratur.snidcidadeibgedest": fields.snidcidadeibgedest,
  };
}

export function assembleEmbraturFromSources(
  sources: Record<string, unknown>,
): Record<string, unknown> | null {
  const existing =
    sources.embratur && typeof sources.embratur === "object" && !Array.isArray(sources.embratur)
      ? { ...(sources.embratur as Record<string, unknown>) }
      : {};

  const readNum = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = sources[k] ?? existing[k.replace(/^embratur\./, "")];
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
    }
    return undefined;
  };
  const readStr = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = sources[k] ?? existing[k.replace(/^embratur\./, "")];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };

  const snmotvia = readNum("snmotvia", "embratur.snmotvia");
  const sntiptran = readNum("sntiptran", "embratur.sntiptran");
  const bgstdscpais = readStr("bgstdscpais", "embratur.bgstdscpais", "paisResidencia");
  const bgstdscpaisdest = readStr(
    "bgstdscpaisdest",
    "embratur.bgstdscpaisdest",
    "paisDestino",
  );
  const snidcidadeibge = readNum("snidcidadeibge", "embratur.snidcidadeibge");
  const snidcidadeibgedest = readNum("snidcidadeibgedest", "embratur.snidcidadeibgedest");

  // Fallback: texto da ficha ainda no histórico / slot.
  const rawForm =
    (typeof sources.__travelFormMessage === "string" && sources.__travelFormMessage) ||
    (typeof sources.travelFormMessage === "string" && sources.travelFormMessage) ||
    "";
  if (
    (snmotvia == null ||
      sntiptran == null ||
      !bgstdscpais ||
      !bgstdscpaisdest ||
      snidcidadeibge == null ||
      snidcidadeibgedest == null) &&
    rawForm
  ) {
    const mapped = mapTravelFormToEmbraturFields(rawForm);
    if (mapped) {
      return { ...existing, ...mapped };
    }
  }

  if (
    snmotvia == null ||
    sntiptran == null ||
    !bgstdscpais ||
    !bgstdscpaisdest ||
    snidcidadeibge == null ||
    snidcidadeibgedest == null
  ) {
    return Object.keys(existing).length > 0 ? existing : null;
  }

  return {
    ...existing,
    snmotvia,
    sntiptran,
    bgstdscpais,
    bgstdscpaisdest,
    snidcidadeibge,
    snidcidadeibgedest,
  };
}

/** Extrai slots Embratur a partir da mensagem da ficha (S9b). */
export function extractEmbraturSlotsFromTravelForm(
  userMessage: string,
): Record<string, string | number | boolean> {
  const mapped = mapTravelFormToEmbraturFields(userMessage);
  if (!mapped) {
    // Guarda texto bruto para remapear no S10 se o parse parcial falhar.
    const trimmed = userMessage.trim().slice(0, 1500);
    return trimmed ? { __travelFormMessage: trimmed } : {};
  }
  return {
    ...embraturFieldsToFlowSlots(mapped),
    __travelFormMessage: userMessage.trim().slice(0, 1500),
  };
}
