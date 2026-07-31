/**
 * Resolve IDs Embratur consultando a tool `embratur-reference` (domínios FNRH).
 * Nunca inventa IDs — cada campo é resolvido contra respostas reais da API.
 */

import {
  EMBRATUR_REFERENCE_CATALOG_SLOT,
  mapTravelFormToEmbraturViaReferenceCatalog,
  mergeEmbraturReferenceCatalogFlowSlots,
  mergeEmbraturReferenceCatalogs,
  parseEmbraturReferenceCatalog,
  readEmbraturReferenceCatalogFromFlowSlots,
  resolveReferenceEntryId,
  type EmbraturReferenceCatalog,
} from "./embraturReferenceCatalog.js";
import {
  buildFilteredLookupArgs,
  buildListDomainArgs,
  domainsForKind,
  EMBRATUR_DOMAIN_SPECS,
  type EmbraturReferenceDomainKind,
} from "./embraturReferenceDomains.js";
import { EMBRATUR_RESOLUTION_PENDING_SLOT } from "./embraturRuntimeGuards.js";
import {
  assembleEmbraturFromSources,
  embraturFieldsToFlowSlots,
  parseTravelFormFields,
  type EmbraturCheckInFields,
} from "./embraturTravelForm.js";

export type EmbraturReferenceInvokeResult = {
  ok: boolean;
  responseText?: string;
  structuredPayload?: unknown;
};

export type EmbraturReferenceInvoker = (
  args: Record<string, unknown>,
) => Promise<EmbraturReferenceInvokeResult>;

const REQUIRED_EMBRATUR_KEYS: Array<keyof EmbraturCheckInFields> = [
  "snmotvia",
  "sntiptran",
  "bgstdscpais",
  "bgstdscpaisdest",
  "snidcidadeibge",
  "snidcidadeibgedest",
];

function catalogBucketForKind(
  kind: EmbraturReferenceDomainKind,
): keyof Pick<EmbraturReferenceCatalog, "motivos" | "transportes" | "paises" | "cidades"> {
  return EMBRATUR_DOMAIN_SPECS[kind].catalogBucket;
}

function emptyCatalog(): EmbraturReferenceCatalog {
  return { motivos: [], transportes: [], paises: [], cidades: [] };
}

function flattenScalarSources(sources: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sources)) {
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object)) {
      out[k] = (v as { value?: unknown }).value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function mergeCatalogFromInvokeResult(
  catalog: EmbraturReferenceCatalog,
  result: EmbraturReferenceInvokeResult,
): EmbraturReferenceCatalog {
  if (!result.ok) return catalog;
  const patch = parseEmbraturReferenceCatalog(result.structuredPayload ?? result.responseText);
  if (
    patch.motivos.length +
      patch.transportes.length +
      patch.paises.length +
      patch.cidades.length ===
    0
  ) {
    return catalog;
  }
  return mergeEmbraturReferenceCatalogs(catalog, patch);
}

/**
 * Consulta `embratur-reference` para um campo: lista domínio completo + lookups filtrados.
 * Cache em flowSlots é só aceleração — sempre tenta API quando o match falha.
 */
async function resolveFieldViaReference(
  catalog: EmbraturReferenceCatalog,
  kind: EmbraturReferenceDomainKind,
  guestText: string,
  invokeReference?: EmbraturReferenceInvoker,
): Promise<{ id: string | null; catalog: EmbraturReferenceCatalog }> {
  const text = guestText.trim();
  if (!text) return { id: null, catalog };

  const bucket = catalogBucketForKind(kind);
  let hit = resolveReferenceEntryId(catalog[bucket], text);
  if (hit) return { id: hit, catalog };

  if (!invokeReference) return { id: null, catalog };

  // 1) Listar domínio completo (embratur_cb_country, etc.)
  for (const domain of domainsForKind(kind)) {
    try {
      const listResult = await invokeReference(buildListDomainArgs(domain));
      catalog = mergeCatalogFromInvokeResult(catalog, listResult);
      hit = resolveReferenceEntryId(catalog[bucket], text);
      if (hit) return { id: hit, catalog };
    } catch {
      /* best-effort */
    }
  }

  // 2) Lookups filtrados por texto
  for (const args of buildFilteredLookupArgs(kind, text)) {
    try {
      const result = await invokeReference(args);
      catalog = mergeCatalogFromInvokeResult(catalog, result);
      hit = resolveReferenceEntryId(catalog[bucket], text);
      if (hit) return { id: hit, catalog };
    } catch {
      /* best-effort */
    }
  }

  return { id: resolveReferenceEntryId(catalog[bucket], text), catalog };
}

/** Verifica se flowSlots / facts já têm os 6 campos Embratur resolvidos. */
export function hasCompleteEmbraturFields(sources: Record<string, unknown>): boolean {
  const embratur = assembleEmbraturFromSources(flattenScalarSources(sources));
  if (!embratur) return false;
  return REQUIRED_EMBRATUR_KEYS.every((k) => {
    const v = embratur[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

/** Chaves Embratur em falta (para erro de tool / mensagem ao hóspede). */
export function listMissingEmbraturFieldKeys(sources: Record<string, unknown>): string[] {
  const flat = flattenScalarSources(sources);
  const embratur = assembleEmbraturFromSources(flat);
  const missing: string[] = [];
  for (const k of REQUIRED_EMBRATUR_KEYS) {
    const v = embratur?.[k] ?? flat[k] ?? flat[`embratur.${k}`];
    if (v === undefined || v === null || String(v).trim() === "") {
      missing.push(`embratur.${k}`);
    }
  }
  return missing;
}

/**
 * Resolve ficha → IDs via consultas à `embratur-reference`.
 * Retorna flowSlots prontos para persistência (incl. cache de respostas API).
 */
export async function resolveEmbraturSlotsForTravelForm(input: {
  userMessage: string;
  flowSlots?: Record<string, unknown> | null;
  invokeReference?: EmbraturReferenceInvoker;
}): Promise<Record<string, string | number | boolean>> {
  const trimmed = input.userMessage.trim().slice(0, 1500);
  if (!trimmed) return {};

  let catalog =
    readEmbraturReferenceCatalogFromFlowSlots(input.flowSlots ?? undefined) ?? emptyCatalog();

  const fields = parseTravelFormFields(trimmed);

  const resolutions: Array<[EmbraturReferenceDomainKind, string]> = [
    ["motivo", fields.motivo],
    ["transporte", fields.transporte],
    ["pais", fields.paisResidencia],
    ["pais", fields.paisDestino],
    ["cidade", fields.cidadeProcedencia],
    ["cidade", fields.cidadeDestino],
  ];

  for (const [kind, guestText] of resolutions) {
    const resolved = await resolveFieldViaReference(
      catalog,
      kind,
      guestText,
      input.invokeReference,
    );
    catalog = resolved.catalog;
  }

  const mapped = mapTravelFormToEmbraturViaReferenceCatalog(trimmed, catalog);
  const out: Record<string, string | number | boolean> = {
    __travelFormMessage: trimmed,
    [EMBRATUR_REFERENCE_CATALOG_SLOT]: JSON.stringify(catalog).slice(0, 12_000),
  };

  if (mapped) {
    Object.assign(out, embraturFieldsToFlowSlots(mapped));
    out[EMBRATUR_RESOLUTION_PENDING_SLOT] = false;
  } else {
    out[EMBRATUR_RESOLUTION_PENDING_SLOT] = true;
  }

  return out;
}

/** Mescla outcome da reference nos flowSlots (preserva entradas anteriores). */
export function mergeReferenceOutcomeIntoFlowSlots(
  flowSlots: Record<string, unknown>,
  outcome: { ok?: boolean; preview?: string; structuredPayload?: unknown },
): Record<string, unknown> {
  const merged = mergeEmbraturReferenceCatalogFlowSlots(flowSlots, {
    ok: outcome.ok !== false,
    responseText: outcome.preview,
    structuredPayload: outcome.structuredPayload,
  });
  if (Object.keys(merged).length === 0) return flowSlots;
  return { ...flowSlots, ...merged };
}

export function embraturFieldsFromResolvedSlots(
  slots: Record<string, unknown>,
): EmbraturCheckInFields | null {
  const embratur = assembleEmbraturFromSources(slots);
  if (!embratur || !hasCompleteEmbraturFields(slots)) return null;
  return embratur as EmbraturCheckInFields;
}

/** Texto de viagem a usar para resolução (ficha actual ou persistida). */
export function travelFormTextFromFlowSlots(
  flowSlots: Record<string, unknown>,
  userMessage?: string,
): string {
  const fromMsg =
    userMessage && parseTravelFormFields(userMessage).motivo ? userMessage.trim() : "";
  if (fromMsg) return fromMsg.slice(0, 1500);
  const stored = flowSlots.__travelFormMessage;
  if (typeof stored === "string" && stored.trim()) return stored.trim().slice(0, 1500);
  return "";
}
