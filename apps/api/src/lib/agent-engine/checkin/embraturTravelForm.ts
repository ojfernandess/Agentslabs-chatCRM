/**
 * Ficha de viagem (S9b) → payload Embratur do audaar_check_in.
 * IDs vêm EXCLUSIVAMENTE do catálogo `embratur-reference` (S9) — sem tabelas fixas no runtime.
 */

import {
  EMBRATUR_REFERENCE_CATALOG_SLOT,
  mapTravelFormToEmbraturViaReferenceCatalog,
  parseEmbraturReferenceCatalog,
  readEmbraturReferenceCatalogFromFlowSlots,
  type EmbraturReferenceCatalog,
} from "./embraturReferenceCatalog.js";

export type EmbraturCheckInFields = {
  snmotvia: string;
  sntiptran: string;
  bgstdscpais: string;
  bgstdscpaisdest: string;
  snidcidadeibge: string;
  snidcidadeibgedest: string;
};

export { EMBRATUR_REFERENCE_CATALOG_SLOT };

/** Remove markdown (* **, _) que o LLM/WhatsApp mete nos rótulos da ficha. */
export function normalizeTravelFormMessage(userMessage: string): string {
  return (userMessage ?? "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`+/g, "")
    .replace(/(^|\n)\s*[*•\-–—]\s+/gm, "$1")
    .replace(/\s*[:：]\s*/g, ": ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractLabeledField(msg: string, labels: RegExp): string {
  const m = msg.match(labels);
  if (!m?.[1]) return "";
  return m[1]
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const msg = normalizeTravelFormMessage(userMessage);
  const sep = String.raw`\s*[:：]\s*`;
  const value = String.raw`([^\n]+?)(?:\s*$|\s*(?=\n)|(?=\s*\n))`;
  return {
    motivo: extractLabeledField(
      msg,
      new RegExp(String.raw`(?:motivo(?:\s+da\s+viagem)?)${sep}${value}`, "i"),
    ),
    transporte: extractLabeledField(
      msg,
      new RegExp(
        String.raw`(?:meio\s+de\s+transporte(?:\s+da\s+chegada)?|transporte)${sep}${value}`,
        "i",
      ),
    ),
    paisResidencia: extractLabeledField(
      msg,
      new RegExp(
        String.raw`(?:pa[ií]s\s+de\s+resid(?:[eê]ncia)?(?:\s+permanente)?)${sep}${value}`,
        "i",
      ),
    ),
    paisDestino: extractLabeledField(
      msg,
      new RegExp(String.raw`(?:pa[ií]s\s+de\s+destino)${sep}${value}`, "i"),
    ),
    cidadeProcedencia: extractLabeledField(
      msg,
      new RegExp(String.raw`(?:cidade\s+de\s+proced[eê]ncia)${sep}${value}`, "i"),
    ),
    cidadeDestino: extractLabeledField(
      msg,
      new RegExp(String.raw`(?:cidade\s+de\s+destino)${sep}${value}`, "i"),
    ),
  };
}

function readCatalogFromSources(sources: Record<string, unknown>): EmbraturReferenceCatalog | null {
  const fromSlot = readEmbraturReferenceCatalogFromFlowSlots(sources);
  if (fromSlot) return fromSlot;
  const raw = sources[EMBRATUR_REFERENCE_CATALOG_SLOT];
  if (typeof raw === "string" && raw.trim()) {
    return parseEmbraturReferenceCatalog(raw);
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return parseEmbraturReferenceCatalog(raw);
  }
  return null;
}

/**
 * Converte texto da ficha → campos Embratur via catálogo da reference.
 * Retorna null se faltar catálogo ou match — NUNCA inventa IDs.
 */
export function mapTravelFormToEmbraturFields(
  userMessage: string,
  catalog?: EmbraturReferenceCatalog | null,
): EmbraturCheckInFields | null {
  return mapTravelFormToEmbraturViaReferenceCatalog(userMessage, catalog ?? null);
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

/** Aceita só código numérico já resolvido — não traduz nomes de país. */
function coerceResolvedCountryCode(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d{3,7}$/.test(t)) return t;
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
      const c = coerceResolvedCountryCode(v);
      if (c) return c;
    }
    return undefined;
  };

  let snmotvia = readId("snmotvia", "embratur.snmotvia");
  let sntiptran = readId("sntiptran", "embratur.sntiptran");
  let bgstdscpais = readCountry("bgstdscpais", "embratur.bgstdscpais");
  let bgstdscpaisdest = readCountry("bgstdscpaisdest", "embratur.bgstdscpaisdest");
  let snidcidadeibge = readId("snidcidadeibge", "embratur.snidcidadeibge");
  let snidcidadeibgedest = readId("snidcidadeibgedest", "embratur.snidcidadeibgedest");

  const catalog = readCatalogFromSources(sources);
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
    rawForm &&
    catalog
  ) {
    const mapped = mapTravelFormToEmbraturViaReferenceCatalog(rawForm, catalog);
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

/** Extrai slots Embratur a partir da mensagem da ficha (S9b) + catálogo S9. */
export function extractEmbraturSlotsFromTravelForm(
  userMessage: string,
  catalog?: EmbraturReferenceCatalog | null,
): Record<string, string | number | boolean> {
  const resolvedCatalog = catalog ?? null;
  const mapped = mapTravelFormToEmbraturViaReferenceCatalog(userMessage, resolvedCatalog);
  const trimmed = userMessage.trim().slice(0, 1500);
  if (!mapped) {
    return trimmed ? { __travelFormMessage: trimmed } : {};
  }
  return {
    ...embraturFieldsToFlowSlots(mapped),
    __travelFormMessage: trimmed,
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

  const embratur = assembleEmbraturFromSources(out);
  if (embratur && Object.keys(embratur).length > 0) {
    out.embratur = embratur;
  }

  return out;
}

/** @deprecated Sem catálogo da reference não há mapeamento — mantido só para compat de imports. */
export function mapCountryToEmbraturCode(_raw: string): string | null {
  return null;
}
