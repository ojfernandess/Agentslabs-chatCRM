import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEmbraturReferenceCatalog,
  mapTravelFormToEmbraturViaReferenceCatalog,
  resolveReferenceEntryId,
  buildModeloS9TemplateFromCatalog,
  extractEmbraturReferenceCatalogFlowSlots,
} from "./embraturReferenceCatalog.js";

const SAMPLE_REFERENCE = {
  motivosViagem: [
    { id: 3, nome: "Congresso/Feira" },
    { id: 7, nome: "Saúde" },
  ],
  meiosTransporte: [
    { id: 2, nome: "Automóvel" },
    { id: 1, nome: "Avião" },
  ],
  paises: [
    { id: "1058", nome: "Brasil" },
    { id: "6289", nome: "Inglaterra" },
  ],
  cidades: [
    { id: 3550308, nome: "São Paulo" },
    { id: 3304557, nome: "Rio de Janeiro" },
  ],
};

const FORM_CONGRESSO = `* Motivo da viagem: Congresso
* Meio de transporte: Automóvel
* País de residência: Brasil
* País de destino: Brasil
* Cidade de procedência: São Paulo
* Cidade de destino: São Paulo`;

const FORM_INGLATERRA = `* Motivo da viagem: Saúde
* Meio de transporte: Automóvel
* País de residência: Brasil
* País de destino: Inglaterra
* Cidade de procedência: São Paulo
* Cidade de destino: São Paulo`;

test("parseEmbraturReferenceCatalog extracts motivos/transportes/paises/cidades", () => {
  const c = parseEmbraturReferenceCatalog(SAMPLE_REFERENCE);
  assert.equal(c.motivos.length, 2);
  assert.equal(c.transportes.length, 2);
  assert.equal(c.paises.length, 2);
  assert.equal(c.cidades.length, 2);
});

test("resolveReferenceEntryId matches Saúde and Inglaterra", () => {
  const c = parseEmbraturReferenceCatalog(SAMPLE_REFERENCE);
  assert.equal(resolveReferenceEntryId(c.motivos, "Saúde"), "7");
  assert.equal(resolveReferenceEntryId(c.paises, "Inglaterra"), "6289");
});

test("mapTravelFormToEmbraturViaReferenceCatalog resolves Congresso/Brasil/SP", () => {
  const c = parseEmbraturReferenceCatalog(SAMPLE_REFERENCE);
  const mapped = mapTravelFormToEmbraturViaReferenceCatalog(FORM_CONGRESSO, c);
  assert.ok(mapped);
  assert.equal(mapped!.snmotvia, "3");
  assert.equal(mapped!.sntiptran, "2");
  assert.equal(mapped!.bgstdscpais, "1058");
  assert.equal(mapped!.bgstdscpaisdest, "1058");
  assert.equal(mapped!.snidcidadeibge, "3550308");
});

test("mapTravelFormToEmbraturViaReferenceCatalog resolves Inglaterra (no hardcoded table)", () => {
  const c = parseEmbraturReferenceCatalog(SAMPLE_REFERENCE);
  const mapped = mapTravelFormToEmbraturViaReferenceCatalog(FORM_INGLATERRA, c);
  assert.ok(mapped);
  assert.equal(mapped!.snmotvia, "7");
  assert.equal(mapped!.bgstdscpaisdest, "6289");
});

test("mapTravelFormToEmbraturViaReferenceCatalog returns null without catalog", () => {
  assert.equal(mapTravelFormToEmbraturViaReferenceCatalog(FORM_CONGRESSO, null), null);
});

test("buildModeloS9TemplateFromCatalog uses reference labels", () => {
  const c = parseEmbraturReferenceCatalog(SAMPLE_REFERENCE);
  const tpl = buildModeloS9TemplateFromCatalog(c);
  assert.ok(tpl);
  assert.match(tpl!, /Congresso\/Feira/);
  assert.match(tpl!, /Automóvel/);
  assert.doesNotMatch(tpl!, /1058/);
});

test("extractEmbraturReferenceCatalogFlowSlots persists catalog JSON", () => {
  const slots = extractEmbraturReferenceCatalogFlowSlots({
    ok: true,
    structuredPayload: SAMPLE_REFERENCE,
  });
  assert.ok(slots.__embraturReferenceCatalog);
  assert.match(slots.__embraturReferenceCatalog, /motivos/);
});
