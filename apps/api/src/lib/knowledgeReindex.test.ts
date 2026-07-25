import assert from "node:assert/strict";
import test from "node:test";
import { chunkKnowledgeDocumentContent } from "./knowledgeMarkdownChunking.js";

const HOTEL_DOC = `# Hotel Test

## WiFi
- Rede: NET
- Senha: abc

## Quartos
### Standard
- 12 m²
`;

test("reindex chunk pipeline produces section-aware pieces", () => {
  const pieces = chunkKnowledgeDocumentContent(HOTEL_DOC, {
    chunkSize: 1500,
    overlap: 200,
    maxChunks: 20,
  });
  assert.ok(pieces.length >= 2);
  const wifi = pieces.find((p) => p.toLowerCase().includes("wifi"));
  assert.ok(wifi);
  assert.ok(wifi!.includes("NET"));
});
