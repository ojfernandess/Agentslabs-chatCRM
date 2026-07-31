/**
 * Domínios FNRH / Embratur expostos pela tool HTTP `embratur-reference`.
 * PROIBIDO inventar IDs — o runtime consulta estes domínios e faz match pelo texto do hóspede.
 *
 * Genérico para qualquer playbook que use reference + check-in com campos Embratur.
 */

import type { EmbraturReferenceCatalog } from "./embraturReferenceCatalog.js";

export type EmbraturReferenceDomainKind = "motivo" | "transporte" | "pais" | "cidade";

export type EmbraturDomainSpec = {
  /** Domínio canónico FNRH (ex.: embratur_cb_country). */
  primaryDomain: string;
  /** Aliases legados ainda aceites pela API. */
  legacyDomains: string[];
  catalogBucket: keyof Pick<EmbraturReferenceCatalog, "motivos" | "transportes" | "paises" | "cidades">;
  /** Chaves flat em flowSlots / payload check-in. */
  slotKeys: string[];
};

/** Registo central — única fonte de domínios; não hardcode fora deste módulo. */
export const EMBRATUR_DOMAIN_SPECS: Record<EmbraturReferenceDomainKind, EmbraturDomainSpec> = {
  motivo: {
    primaryDomain: "embratur_cb_travel_motive",
    legacyDomains: ["motivos_viagem", "motivosViagem", "motivo_viagem"],
    catalogBucket: "motivos",
    slotKeys: ["snmotvia", "embratur.snmotvia"],
  },
  transporte: {
    primaryDomain: "embratur_cb_transport",
    legacyDomains: ["meios_transporte", "meiosTransporte", "meio_transporte"],
    catalogBucket: "transportes",
    slotKeys: ["sntiptran", "embratur.sntiptran"],
  },
  pais: {
    primaryDomain: "embratur_cb_country",
    legacyDomains: ["paises", "pais", "countries", "country"],
    catalogBucket: "paises",
    slotKeys: ["bgstdscpais", "bgstdscpaisdest", "embratur.bgstdscpais", "embratur.bgstdscpaisdest"],
  },
  cidade: {
    primaryDomain: "embratur_cb_city",
    legacyDomains: ["cidades", "cidade", "cities", "municipios", "ibge"],
    catalogBucket: "cidades",
    slotKeys: ["snidcidadeibge", "snidcidadeibgedest", "embratur.snidcidadeibge", "embratur.snidcidadeibgedest"],
  },
};

/** Todos os domínios a consultar (primário + legados), ordem de preferência. */
export function domainsForKind(kind: EmbraturReferenceDomainKind): string[] {
  const spec = EMBRATUR_DOMAIN_SPECS[kind];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [spec.primaryDomain, ...spec.legacyDomains]) {
    const k = d.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

/** Args para listar entradas de um domínio (sem filtro — lista completa da API). */
export function buildListDomainArgs(domain: string): Record<string, unknown> {
  return { dominio: domain, domain };
}

/** Args para lookup filtrado por texto do hóspede. */
export function buildFilteredLookupArgs(
  kind: EmbraturReferenceDomainKind,
  guestText: string,
): Record<string, unknown>[] {
  const text = guestText.trim();
  if (!text) return [];
  const shared = { nome: text, query: text, filtro: text, search: text, label: text, text };
  const out: Record<string, unknown>[] = [];

  for (const domain of domainsForKind(kind)) {
    out.push({ dominio: domain, domain, ...shared });
    out.push({ dominio: domain, domain, referenceType: domain, ...shared });
  }

  switch (kind) {
    case "motivo":
      out.push({ tipo: "motivo", ...shared });
      break;
    case "transporte":
      out.push({ tipo: "transporte", ...shared });
      break;
    case "pais":
      out.push({ pais: text, country: text, tipo: "pais", ...shared });
      break;
    case "cidade":
      out.push({ cidade: text, ibge: text, tipo: "cidade", ...shared });
      break;
  }
  return out;
}
