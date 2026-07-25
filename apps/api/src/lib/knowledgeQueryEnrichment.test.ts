import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeSearchQuery,
  isKnowledgeOverviewChunk,
  knowledgeContentCoversQuery,
  shouldEnrichKnowledgeSearchQuery,
} from "./knowledgeQueryEnrichment.js";

test("shouldEnrichKnowledgeSearchQuery rejects menu digit replies", () => {
  assert.equal(shouldEnrichKnowledgeSearchQuery("1"), false);
  assert.equal(shouldEnrichKnowledgeSearchQuery("sim"), false);
  assert.equal(shouldEnrichKnowledgeSearchQuery("qual wifi?"), true);
});

test("buildKnowledgeSearchQuery does not pollute menu selection with history", () => {
  const q = buildKnowledgeSearchQuery("1", [
    { role: "user", content: "Hotel Brooklin" },
    { role: "assistant", content: "Posso te ajudar de duas formas" },
  ]);
  assert.equal(q, "1");
});

test("buildKnowledgeSearchQuery enriches short wifi query with establishment from history", () => {
  const q = buildKnowledgeSearchQuery("qual wifi?", [
    { role: "user", content: "Estou no Club Suítes — Base de Conhecimento" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
    { role: "user", content: "Club Suítes Campo Belo" },
  ]);
  assert.ok(q.toLowerCase().includes("wifi"));
  assert.ok(q.toLowerCase().includes("club"));
});

test("knowledgeContentCoversQuery false for header-only appendix", () => {
  const appendix = "### Base de conhecimento\n**1. Hotel X**\n## Categorias de quartos";
  assert.equal(knowledgeContentCoversQuery(appendix, "quais quartos?"), false);
});

test("knowledgeContentCoversQuery true when appendix contains wifi section data", () => {
  const appendix =
    "### Base de conhecimento\n**1. Hotel X**\n## WiFi\n- **Rede:** HOTEL X\n- **Senha:** abc123";
  assert.equal(knowledgeContentCoversQuery(appendix, "qual wifi?"), true);
});

test("isKnowledgeOverviewChunk detects catalog intro from optimized docs", () => {
  const intro =
    "## Rock Blue Ocean Suites — Base de Conhecimento\n\n" +
    "Documento da unidade **Rock Blue Ocean Suites** para consulta via buscar_conhecimento. " +
    "Seções com títulos que correspondem a possíveis buscas (WiFi, estacionamento, categorias de quartos, etc.).";
  assert.equal(isKnowledgeOverviewChunk(intro), true);
});

test("knowledgeContentCoversQuery false when only intro mentions room categories", () => {
  const intro =
    "## Rock Blue Ocean Suites — Base de Conhecimento\n\n" +
    "Documento da unidade **Rock Blue Ocean Suites** para consulta via buscar_conhecimento. " +
    "Seções com títulos que correspondem a possíveis buscas (WiFi, estacionamento, categorias de quartos, etc.).";
  assert.equal(
    knowledgeContentCoversQuery(intro, "quais as categorias de quartos do hotel Blue Ocean?"),
    false,
  );
});

test("knowledgeContentCoversQuery true when room section has facts", () => {
  const rooms =
    "## Categorias de quartos / Acomodações\n\n" +
    "- **Standard:** 12 m² · 1 hóspede\n" +
    "- **Superior:** 18 m² · 2 hóspedes";
  assert.equal(
    knowledgeContentCoversQuery(rooms, "quais as categorias de quartos do hotel Blue Ocean?"),
    true,
  );
});

test("knowledgeContentCoversQuery false for NF field label Quarto", () => {
  const nf =
    "## Nota fiscal (NF)\n\nPara emitir nota fiscal:\n\n- Nome completo\n- CPF\n- Quarto\n\n---";
  assert.equal(
    knowledgeContentCoversQuery(nf, "quais as categorias de quartos do hotel Blue Ocean?"),
    false,
  );
});

test("knowledgeContentCoversQuery false for room header without body facts", () => {
  const headerOnly = "## Categorias de quartos\n\nConsulte a recepção para mais detalhes.";
  assert.equal(
    knowledgeContentCoversQuery(headerOnly, "quais as categorias de quartos do hotel Blue Ocean?"),
    false,
  );
});
