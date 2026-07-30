/**
 * Mapeia a ficha de viagem (S9b) → payload Embratur do audaar_check_in.
 * IDs alinhados a docs/prompt.md (tabela «ids Embratur — SOMENTE no S10»).
 * País = código Embratur (Brasil → "1058"), não o nome textual.
 */

export type EmbraturCheckInFields = {
  snmotvia: string;
  sntiptran: string;
  bgstdscpais: string;
  bgstdscpaisdest: string;
  snidcidadeibge: string;
  snidcidadeibgedest: string;
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

/** País → código Embratur (bgstdscpais / bgstdscpaisdest). */
const COUNTRY_CODES: Array<{ re: RegExp; id: string }> = [
  { re: /^brasil$/i, id: "1058" },
  { re: /^brazil$/i, id: "1058" },
  { re: /^1058$/, id: "1058" },
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
  // Já é código IBGE numérico
  if (/^\d{7}$/.test(t)) return Number(t);
  return null;
}

/** Nome do país ou código já numérico → id Embratur. */
export function mapCountryToEmbraturCode(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  for (const c of COUNTRY_CODES) {
    if (c.re.test(t)) return c.id;
  }
  if (/^\d{3,5}$/.test(t)) return t;
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
  const bgstdscpais = mapCountryToEmbraturCode(f.paisResidencia);
  const bgstdscpaisdest = mapCountryToEmbraturCode(f.paisDestino);
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
    snmotvia: String(snmotvia),
    sntiptran: String(sntiptran),
    bgstdscpais,
    bgstdscpaisdest,
    snidcidadeibge: String(snidcidadeibge),
    snidcidadeibgedest: String(snidcidadeibgedest),
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

function coerceEmbraturId(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function coerceCountryCode(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) {
    return mapCountryToEmbraturCode(v.trim()) ?? undefined;
  }
  return undefined;
}

export function assembleEmbraturFromSources(
  sources: Record<string, unknown>,
): Record<string, unknown> | null {
  const existing =
    sources.embratur && typeof sources.embratur === "object" && !Array.isArray(sources.embratur)
      ? { ...(sources.embratur as Record<string, unknown>) }
      : {};

  const readId = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = sources[k] ?? existing[k.replace(/^embratur\./, "")];
      const c = coerceEmbraturId(v);
      if (c) return c;
    }
    return undefined;
  };
  const readCountry = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = sources[k] ?? existing[k.replace(/^embratur\./, "")];
      const c = coerceCountryCode(v);
      if (c) return c;
    }
    return undefined;
  };

  let snmotvia = readId("snmotvia", "embratur.snmotvia");
  let sntiptran = readId("sntiptran", "embratur.sntiptran");
  let bgstdscpais = readCountry("bgstdscpais", "embratur.bgstdscpais", "paisResidencia");
  let bgstdscpaisdest = readCountry(
    "bgstdscpaisdest",
    "embratur.bgstdscpaisdest",
    "paisDestino",
  );
  let snidcidadeibge = readId("snidcidadeibge", "embratur.snidcidadeibge");
  let snidcidadeibgedest = readId("snidcidadeibgedest", "embratur.snidcidadeibgedest");

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

  // Re-normaliza país se veio como "Brasil" no objecto existing.
  if (existing.bgstdscpais != null && !bgstdscpais) {
    bgstdscpais = coerceCountryCode(existing.bgstdscpais);
  }
  if (existing.bgstdscpaisdest != null && !bgstdscpaisdest) {
    bgstdscpaisdest = coerceCountryCode(existing.bgstdscpaisdest);
  }
  if (typeof existing.bgstdscpais === "string" && !/^\d+$/.test(existing.bgstdscpais.trim())) {
    const fixed = coerceCountryCode(existing.bgstdscpais);
    if (fixed) existing.bgstdscpais = fixed;
  }
  if (typeof existing.bgstdscpaisdest === "string" && !/^\d+$/.test(existing.bgstdscpaisdest.trim())) {
    const fixed = coerceCountryCode(existing.bgstdscpaisdest);
    if (fixed) existing.bgstdscpaisdest = fixed;
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

const CHECK_IN_MODE_VALUES = new Set(["digital", "reception", "both"]);

/** Normaliza payload audaar_check_in: mode enum, dependents sem slots vazios. */
export function normalizeAudaarCheckInPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };

  const modeRaw = out.mode;
  const modeStr = typeof modeRaw === "string" ? modeRaw.trim().toLowerCase() : "";
  if (!CHECK_IN_MODE_VALUES.has(modeStr)) {
    out.mode = "digital";
  } else {
    out.mode = modeStr;
  }

  if (out.approveCheckin === undefined) out.approveCheckin = true;
  if (out.sentToReception === undefined) out.sentToReception = true;
  if (out.validatedCheckin === undefined) out.validatedCheckin = true;

  if (Array.isArray(out.dependents)) {
    const cleaned = out.dependents.filter((d) => {
      if (!d || typeof d !== "object" || Array.isArray(d)) return false;
      const o = d as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const doc = typeof o.documentNumber === "string" ? o.documentNumber.trim() : "";
      const id = o.dependentId;
      return name.length > 0 || doc.length > 0 || (typeof id === "number" && Number.isFinite(id));
    });
    if (cleaned.length > 0) out.dependents = cleaned;
    else delete out.dependents;
  }

  // Garante Embratur com códigos de país (1058) mesmo se veio "Brasil" no objecto.
  const embratur = assembleEmbraturFromSources(out);
  if (embratur && Object.keys(embratur).length > 0) {
    out.embratur = embratur;
  }

  return out;
}
