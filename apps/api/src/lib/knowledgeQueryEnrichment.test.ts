import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeSearchQuery,
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
