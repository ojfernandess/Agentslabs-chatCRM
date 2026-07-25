import assert from "node:assert/strict";
import test from "node:test";
import { chunkKnowledgeDocumentContent, contentHasMarkdownSections } from "./knowledgeMarkdownChunking.js";

const SAMPLE = `# Hotel Test — Base de Conhecimento

Intro curta.

---

## WiFi

- **Rede:** TEST_NET
- **Senha:** secret

---

## Estacionamento

- Possui estacionamento.
- Valor: R$ 50,00
`;

test("contentHasMarkdownSections detects markdown sections", () => {
  assert.equal(contentHasMarkdownSections(SAMPLE), true);
});

test("chunkKnowledgeDocumentContent keeps WiFi and parking in separate chunks", () => {
  const chunks = chunkKnowledgeDocumentContent(SAMPLE, { chunkSize: 1500, maxChunks: 20 });
  const joined = chunks.join("\n---\n").toLowerCase();
  assert.ok(joined.includes("wifi"));
  assert.ok(joined.includes("estacionamento"));
  const wifiChunk = chunks.find((c) => c.toLowerCase().includes("wifi"));
  assert.ok(wifiChunk);
  assert.ok(wifiChunk!.toLowerCase().includes("test_net"));
  assert.ok(!wifiChunk!.toLowerCase().includes("estacionamento"));
});
