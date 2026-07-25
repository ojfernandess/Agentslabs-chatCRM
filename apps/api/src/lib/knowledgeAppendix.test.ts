import assert from "node:assert/strict";
import test from "node:test";
import { kbAppendixHasRetrievedExcerpts } from "./kbAppendix.js";

test("kbAppendixHasRetrievedExcerpts false on empty", () => {
  assert.equal(kbAppendixHasRetrievedExcerpts(""), false);
  assert.equal(kbAppendixHasRetrievedExcerpts("   "), false);
});

test("kbAppendixHasRetrievedExcerpts false on no-match template", () => {
  const noMatch =
    "\n\n### Base de conhecimento (pesquisa automática na última mensagem do cliente)\n" +
    "Não foi encontrado nenhum trecho indexado relevante. Não invente factos.";
  assert.equal(kbAppendixHasRetrievedExcerpts(noMatch), false);
});

test("kbAppendixHasRetrievedExcerpts true when excerpts header present without no-match line", () => {
  const ok =
    "\n\n### Base de conhecimento (excertos recuperados automaticamente)\n**1. Doc** (relevância 0.9)\nRua A";
  assert.equal(kbAppendixHasRetrievedExcerpts(ok), true);
});

test("kbAppendixHasRetrievedExcerpts true for generic KB header with excerpts", () => {
  const ok =
    "\n\n### Base de conhecimento (pesquisa automática)\n**1. Plano Enterprise** (relevância 0.9)\nPolítica de cancelamento em 30 dias.";
  assert.equal(kbAppendixHasRetrievedExcerpts(ok), true);
});

test("kbAppendixHasRetrievedExcerpts true for LlamaIndex appendix with excerpts", () => {
  const ok =
    "\n\n### Base de conhecimento (LlamaIndex)\n**1. Hotel Brooklin** (LlamaIndex relevância 0.95)\nQuartos standard e deluxe.";
  assert.equal(kbAppendixHasRetrievedExcerpts(ok), true);
});

test("kbAppendixHasRetrievedExcerpts false for empty LlamaIndex header", () => {
  const empty = "\n\n### Base de conhecimento (LlamaIndex)\n";
  assert.equal(kbAppendixHasRetrievedExcerpts(empty), false);
});
