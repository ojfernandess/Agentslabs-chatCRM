/**
 * Resolve IDs Embratur a partir da ficha do hóspede + catálogo `embratur-reference`.
 * Chamadas extra à reference são internas ao runtime (S9b/S10) — não expostas ao LLM.
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

type LookupKind = "motivo" | "transporte" | "pais" | "cidade";

function buildLookupArgCandidates(kind: LookupKind, guestText: string): Record<string, unknown>[] {
  const text = guestText.trim();
  if (!text) return [];
  const shared = { nome: text, query: text, filtro: text, search: text, label: text };
  switch (kind) {
    case "motivo":
      return [
        { dominio: "motivos_viagem", ...shared },
        { domain: "motivosViagem", ...shared },
        { tipo: "motivo", ...shared },
        { referenceType: "motivos_viagem", ...shared },
      ];
    case "transporte":
      return [
        { dominio: "meios_transporte", ...shared },
        { domain: "meiosTransporte", ...shared },
        { tipo: "transporte", ...shared },
        { referenceType: "meios_transporte", ...shared },
      ];
    case "pais":
      return [
        { dominio: "paises", ...shared },
        { domain: "paises", ...shared },
        { tipo: "pais", ...shared },
        { pais: text },
        { country: text },
        { referenceType: "paises", ...shared },
      ];
    case "cidade":
      return [
        { dominio: "cidades", ...shared },
        { domain: "cidades", ...shared },
        { tipo: "cidade", ...shared },
        { cidade: text },
        { ibge: text },
        { referenceType: "cidades", ...shared },
      ];
  }
}

function catalogBucketForKind(
  kind: LookupKind,
): keyof Pick<EmbraturReferenceCatalog, "motivos" | "transportes" | "paises" | "cidades"> {
  switch (kind) {
    case "motivo":
      return "motivos";
    case "transporte":
      return "transportes";
    case "pais":
      return "paises";
    case "cidade":
      return "cidades";
  }
}

async function enrichCatalogFromReference(
  catalog: EmbraturReferenceCatalog,
  kind: LookupKind,
  guestText: string,
  invokeReference?: EmbraturReferenceInvoker,
): Promise<EmbraturReferenceCatalog> {
  if (!invokeReference || !guestText.trim()) return catalog;
  const bucket = catalogBucketForKind(kind);
  if (resolveReferenceEntryId(catalog[bucket], guestText)) return catalog;

  for (const args of buildLookupArgCandidates(kind, guestText)) {
    try {
      const result = await invokeReference(args);
      if (!result.ok) continue;
      const patch = parseEmbraturReferenceCatalog(
        result.structuredPayload ?? result.responseText,
      );
      if (
        patch.motivos.length +
          patch.transportes.length +
          patch.paises.length +
          patch.cidades.length ===
        0
      ) {
        continue;
      }
      const merged = mergeEmbraturReferenceCatalogs(catalog, patch);
      if (resolveReferenceEntryId(merged[bucket], guestText)) return merged;
      catalog = merged;
    } catch {
      /* best-effort lookup */
    }
  }
  return catalog;
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

/** Verifica se flowSlots / facts já têm os 6 campos Embratur resolvidos. */
export function hasCompleteEmbraturFields(sources: Record<string, unknown>): boolean {
  const embratur = assembleEmbraturFromSources(flattenScalarSources(sources));
  if (!embratur) return false;
  return Boolean(
    embratur.snmotvia &&
      embratur.sntiptran &&
      embratur.bgstdscpais &&
      embratur.bgstdscpaisdest &&
      embratur.snidcidadeibge &&
      embratur.snidcidadeibgedest,
  );
}

/**
 * Resolve ficha → IDs via catálogo + lookups internos à reference.
 * Retorna flowSlots prontos para persistência (incl. catálogo actualizado).
 */
export async function resolveEmbraturSlotsForTravelForm(input: {
  userMessage: string;
  flowSlots?: Record<string, unknown> | null;
  invokeReference?: EmbraturReferenceInvoker;
}): Promise<Record<string, string | number | boolean>> {
  const trimmed = input.userMessage.trim().slice(0, 1500);
  if (!trimmed) return {};

  let catalog =
    readEmbraturReferenceCatalogFromFlowSlots(input.flowSlots ?? undefined) ??
    emptyCatalog();

  const fields = parseTravelFormFields(trimmed);

  catalog = await enrichCatalogFromReference(catalog, "motivo", fields.motivo, input.invokeReference);
  catalog = await enrichCatalogFromReference(
    catalog,
    "transporte",
    fields.transporte,
    input.invokeReference,
  );
  catalog = await enrichCatalogFromReference(
    catalog,
    "pais",
    fields.paisResidencia,
    input.invokeReference,
  );
  catalog = await enrichCatalogFromReference(
    catalog,
    "pais",
    fields.paisDestino,
    input.invokeReference,
  );
  catalog = await enrichCatalogFromReference(
    catalog,
    "cidade",
    fields.cidadeProcedencia,
    input.invokeReference,
  );
  catalog = await enrichCatalogFromReference(
    catalog,
    "cidade",
    fields.cidadeDestino,
    input.invokeReference,
  );

  const mapped = mapTravelFormToEmbraturViaReferenceCatalog(trimmed, catalog);
  const out: Record<string, string | number | boolean> = {
    __travelFormMessage: trimmed,
    [EMBRATUR_REFERENCE_CATALOG_SLOT]: JSON.stringify(catalog).slice(0, 12_000),
  };
  if (mapped) {
    Object.assign(out, embraturFieldsToFlowSlots(mapped));
  }
  return out;
}

function emptyCatalog(): EmbraturReferenceCatalog {
  return { motivos: [], transportes: [], paises: [], cidades: [] };
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
