import assert from "node:assert/strict";
import test from "node:test";
import {
  buscarConhecimentoPreviewHasArticles,
  buscarConhecimentoPreviewToPlainText,
  parseBuscarConhecimentoPreview,
  stripKnowledgeMarkdown,
} from "./knowledgeToolResult.js";

test("parseBuscarConhecimentoPreview reads articles from buscar_conhecimento JSON", () => {
  const preview = JSON.stringify({
    found: true,
    articles: [{ title: "Plano Enterprise — FAQ", excerpt: "**Cancelamento:** 30 dias." }],
  });
  const parsed = parseBuscarConhecimentoPreview(preview);
  assert.equal(parsed?.found, true);
  assert.equal(parsed?.articles?.length, 1);
});

test("buscarConhecimentoPreviewToPlainText strips markdown from excerpts", () => {
  const preview = JSON.stringify({
    found: true,
    articles: [
      {
        title: "Produto Alpha — Manual",
        excerpt: "### Wi-Fi\n- SSID: **GuestNet**\n- Senha: abc123",
      },
    ],
  });
  const plain = buscarConhecimentoPreviewToPlainText(preview);
  assert.match(plain, /Produto Alpha/i);
  assert.match(plain, /GuestNet/i);
  assert.match(plain, /abc123/);
  assert.ok(!plain.includes("**"));
});

test("buscarConhecimentoPreviewHasArticles false when skipped", () => {
  const preview = JSON.stringify({ ok: true, skipped: true, bodyPreview: "quota" });
  assert.equal(buscarConhecimentoPreviewHasArticles(preview), false);
});

test("stripKnowledgeMarkdown removes headings and bold", () => {
  assert.equal(stripKnowledgeMarkdown("## Título\n**Bold** item"), "Título Bold item");
});
