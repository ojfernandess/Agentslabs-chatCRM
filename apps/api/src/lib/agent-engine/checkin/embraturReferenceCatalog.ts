/**
 * Catálogo Embratur vindo da tool `embratur-reference` (S9).
 * PROIBIDO inventar IDs — só resolve texto do hóspede contra este catálogo.
 */

import type { EmbraturCheckInFields } from "./embraturTravelForm.js";
import { parseTravelFormFields } from "./embraturTravelForm.js";

export const EMBRATUR_REFERENCE_CATALOG_SLOT = "__embraturReferenceCatalog";

export type EmbraturReferenceEntry = {
  id: string;
  label: string;
};

export type EmbraturReferenceCatalog = {
  motivos: EmbraturReferenceEntry[];
  transportes: EmbraturReferenceEntry[];
  paises: EmbraturReferenceEntry[];
  cidades: EmbraturReferenceEntry[];
};

const EMPTY_CATALOG: EmbraturReferenceCatalog = {
  motivos: [],
  transportes: [],
  paises: [],
  cidades: [],
};

const MOTIVO_KEY_RE =
  /motivos?(?:_viagem|viagem)?|travelmotives?|snmotvia|motivo_viagem/i;
const TRANSPORTE_KEY_RE =
  /meios?(?:_transporte|transporte)?|transportes?|sntiptran|meio_transporte/i;
const PAIS_KEY_RE = /pa[ií]s(?:es)?|countries|bgstdscpais|fnrh.*pais/i;
const CIDADE_KEY_RE = /cidades?|cities|ibge|snidcidade/i;

function normalizeLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readEntryId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function readEntryLabel(obj: Record<string, unknown>): string {
  for (const k of [
    "label",
    "nome",
    "name",
    "descricao",
    "description",
    "texto",
    "text",
    "titulo",
    "title",
  ]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pushEntry(bucket: EmbraturReferenceEntry[], id: string, label: string): void {
  const lid = id.trim();
  const ll = label.trim();
  if (!lid || !ll) return;
  if (bucket.some((e) => e.id === lid && normalizeLabel(e.label) === normalizeLabel(ll))) return;
  bucket.push({ id: lid, label: ll });
}

function collectEntriesFromArray(arr: unknown[]): EmbraturReferenceEntry[] {
  const out: EmbraturReferenceEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const id = readEntryId(o.id ?? o.codigo ?? o.code ?? o.value ?? o.fnrhId);
    const label = readEntryLabel(o);
    if (id && label) pushEntry(out, id, label);
  }
  return out;
}

function mergeUnique(
  target: EmbraturReferenceEntry[],
  source: EmbraturReferenceEntry[],
): void {
  for (const e of source) pushEntry(target, e.id, e.label);
}

function walkObject(node: unknown, catalog: EmbraturReferenceCatalog, depth = 0): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walkObject(item, catalog, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (!Array.isArray(val)) {
      walkObject(val, catalog, depth + 1);
      continue;
    }
    const entries = collectEntriesFromArray(val);
    if (entries.length === 0) continue;
    if (MOTIVO_KEY_RE.test(key)) mergeUnique(catalog.motivos, entries);
    else if (TRANSPORTE_KEY_RE.test(key)) mergeUnique(catalog.transportes, entries);
    else if (PAIS_KEY_RE.test(key)) mergeUnique(catalog.paises, entries);
    else if (CIDADE_KEY_RE.test(key)) mergeUnique(catalog.cidades, entries);
  }
}

/** Extrai catálogo normalizado da resposta JSON de `embratur-reference`. */
export function parseEmbraturReferenceCatalog(payload: unknown): EmbraturReferenceCatalog {
  const catalog: EmbraturReferenceCatalog = {
    motivos: [],
    transportes: [],
    paises: [],
    cidades: [],
  };
  if (payload == null) return catalog;

  let root: unknown = payload;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root) as unknown;
    } catch {
      return catalog;
    }
  }

  if (root && typeof root === "object" && !Array.isArray(root)) {
    const o = root as Record<string, unknown>;
    for (const wrap of ["data", "result", "body", "dados", "payload", "response"]) {
      if (o[wrap] != null) {
        walkObject(o[wrap], catalog, 0);
      }
    }
    walkObject(root, catalog, 0);
  } else {
    walkObject(root, catalog, 0);
  }

  return catalog;
}

export function catalogHasAnyEntries(catalog: EmbraturReferenceCatalog | null | undefined): boolean {
  if (!catalog) return false;
  return (
    catalog.motivos.length > 0 ||
    catalog.transportes.length > 0 ||
    catalog.paises.length > 0 ||
    catalog.cidades.length > 0
  );
}

export function readEmbraturReferenceCatalogFromFlowSlots(
  flowSlots?: Record<string, unknown> | null,
): EmbraturReferenceCatalog | null {
  if (!flowSlots) return null;
  const raw = flowSlots[EMBRATUR_REFERENCE_CATALOG_SLOT];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as EmbraturReferenceCatalog;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      motivos: Array.isArray(parsed.motivos) ? parsed.motivos : [],
      transportes: Array.isArray(parsed.transportes) ? parsed.transportes : [],
      paises: Array.isArray(parsed.paises) ? parsed.paises : [],
      cidades: Array.isArray(parsed.cidades) ? parsed.cidades : [],
    };
  } catch {
    return null;
  }
}

export function embraturReferenceCatalogToFlowSlot(
  catalog: EmbraturReferenceCatalog,
): Record<string, string> {
  return {
    [EMBRATUR_REFERENCE_CATALOG_SLOT]: JSON.stringify(catalog).slice(0, 12_000),
  };
}

function splitLabelVariants(label: string): string[] {
  const base = normalizeLabel(label);
  const parts = label
    .split(/[/|,;]|(?:\s+e\s+)/i)
    .map((p) => normalizeLabel(p))
    .filter(Boolean);
  return [base, ...parts];
}

/** Resolve texto do hóspede → id do catálogo (match exacto / parcial / variantes). */
export function resolveReferenceEntryId(
  entries: EmbraturReferenceEntry[],
  guestText: string,
): string | null {
  const guest = normalizeLabel(guestText);
  if (!guest) return null;

  // Código numérico já informado pelo hóspede.
  if (/^\d+$/.test(guest)) {
    const hit = entries.find((e) => e.id === guest);
    if (hit) return hit.id;
  }

  for (const entry of entries) {
    for (const variant of splitLabelVariants(entry.label)) {
      if (variant === guest) return entry.id;
      if (variant.length >= 4 && (guest.includes(variant) || variant.includes(guest))) {
        return entry.id;
      }
    }
  }
  return null;
}

/**
 * Converte ficha do hóspede → campos Embratur usando SOMENTE o catálogo da reference.
 * Retorna null se faltar catálogo ou algum match.
 */
export function mapTravelFormToEmbraturViaReferenceCatalog(
  userMessage: string,
  catalog: EmbraturReferenceCatalog | null | undefined,
): EmbraturCheckInFields | null {
  if (!catalogHasAnyEntries(catalog)) return null;
  const f = parseTravelFormFields(userMessage);
  const snmotvia = resolveReferenceEntryId(catalog!.motivos, f.motivo);
  const sntiptran = resolveReferenceEntryId(catalog!.transportes, f.transporte);
  const bgstdscpais = resolveReferenceEntryId(catalog!.paises, f.paisResidencia);
  const bgstdscpaisdest = resolveReferenceEntryId(catalog!.paises, f.paisDestino);
  const snidcidadeibge = resolveReferenceEntryId(catalog!.cidades, f.cidadeProcedencia);
  const snidcidadeibgedest = resolveReferenceEntryId(catalog!.cidades, f.cidadeDestino);

  if (
    !snmotvia ||
    !sntiptran ||
    !bgstdscpais ||
    !bgstdscpaisdest ||
    !snidcidadeibge ||
    !snidcidadeibgedest
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

/** Template S9 com opções vindas da reference (nunca lista fixa hardcoded). */
export function buildModeloS9TemplateFromCatalog(catalog: EmbraturReferenceCatalog): string | null {
  if (!catalogHasAnyEntries(catalog)) return null;
  const fmt = (entries: EmbraturReferenceEntry[]) =>
    entries.map((e) => e.label).filter(Boolean).join(", ");
  const motivos = fmt(catalog.motivos);
  const transportes = fmt(catalog.transportes);
  if (!motivos || !transportes) return null;

  const paisHint =
    catalog.paises.length > 0
      ? `Exemplo: ${catalog.paises[0]!.label}`
      : "Informe o país";
  const cidadeHint =
    catalog.cidades.length > 0
      ? `Exemplo: ${catalog.cidades[0]!.label}`
      : "Informe a cidade";

  return (
    `Para finalizar, envie de uma vez as informações da viagem:\n` +
    `1. Qual é o motivo da viagem? (${motivos})\n` +
    `2. Qual é o meio de transporte da chegada? (${transportes})\n` +
    `3. Qual é o país de residência permanente? ${paisHint}\n` +
    `4. Qual é o país de destino? ${paisHint}\n` +
    `5. Qual é a cidade de procedência? ${cidadeHint}\n` +
    `6. Qual é a cidade de destino? ${cidadeHint}\n` +
    `Pode responder em uma única mensagem.`
  );
}

export function emptyEmbraturReferenceCatalog(): EmbraturReferenceCatalog {
  return { ...EMPTY_CATALOG, motivos: [], transportes: [], paises: [], cidades: [] };
}

/** Persiste catálogo em flowSlots a partir da resposta HTTP da tool `embratur-reference`. */
export function extractEmbraturReferenceCatalogFlowSlots(input: {
  responseText?: string;
  structuredPayload?: unknown;
  ok?: boolean;
}): Record<string, string> {
  if (input.ok === false) return {};
  let catalog = parseEmbraturReferenceCatalog(input.structuredPayload);
  if (!catalogHasAnyEntries(catalog) && input.responseText?.trim()) {
    const t = input.responseText.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        catalog = parseEmbraturReferenceCatalog(JSON.parse(t));
      } catch {
        /* ignore */
      }
    }
  }
  if (!catalogHasAnyEntries(catalog)) return {};
  return embraturReferenceCatalogToFlowSlot(catalog);
}
