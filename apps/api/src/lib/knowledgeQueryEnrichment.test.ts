import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeSearchQuery,
  knowledgeContentCoversQuery,
} from "./knowledgeQueryEnrichment.js";

test("buildKnowledgeSearchQuery enriches short wifi query with establishment from history", () => {
  const q = buildKnowledgeSearchQuery("qual wifi?", [
    { role: "user", content: "Estou no Club Suítes — Base de Conhecimento" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
    { role: "user", content: "Club Suítes Campo Belo" },
  ]);
  assert.ok(q.toLowerCase().includes("wifi"));
  assert.ok(q.toLowerCase().includes("club"));
});

test("buildKnowledgeSearchQuery adds topic synonyms for parking questions", () => {
  const q = buildKnowledgeSearchQuery("tem estacionamento?", []);
  assert.match(q.toLowerCase(), /estacionamento|parking|vaga/);
});

test("knowledgeContentCoversQuery true when appendix contains wifi section data", () => {
  const appendix =
    "### Base de conhecimento\n**1. Hotel X**\n## WiFi\n- **Rede:** HOTEL X\n- **Senha:** abc123";
  assert.equal(knowledgeContentCoversQuery(appendix, "qual wifi?"), true);
});

test("knowledgeContentCoversQuery false when excerpts lack the asked topic", () => {
  const appendix =
    "### Base de conhecimento\n**1. Hotel X**\n## Estacionamento\n- Não possui estacionamento.";
  assert.equal(knowledgeContentCoversQuery(appendix, "qual wifi?"), false);
});
