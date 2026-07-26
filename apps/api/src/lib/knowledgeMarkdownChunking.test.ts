import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkKnowledgeDocumentContent,
  contentHasMarkdownSections,
  extractMarkdownSectionForQuery,
  hasSubstantiveChunkBody,
} from "./knowledgeMarkdownChunking.js";
import { knowledgeContentCoversQuery } from "./knowledgeQueryEnrichment.js";

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

const BROOKLIN_ROOMS = `# Hotel Brooklin — Base de Conhecimento

Documento da unidade **Hotel Brooklin** para consulta via buscar_conhecimento.

## WiFi / Internet
- **Rede:** HOTEL BROOKLIN

## Categorias de Quartos / Acomodações

### Suíte Standard Individual
- **Tamanho:** 12 m²
- **Capacidade:** até 1 hóspede
- **Camas:** 1 cama de solteiro

### Suíte Standard Duplo Casal
- **Tamanho:** 14 m²
- **Capacidade:** 2 hóspedes
- **Camas:** 1 cama de casal

### Suíte Standard Quadruplo
- **Tamanho:** 15 m²
- **Capacidade:** 4 hóspedes
- **Camas:** 4 camas de solteiro

## Nota Fiscal (NF)
- Quarto
`;

test("chunkKnowledgeDocumentContent aggregates ### room subsections into parent ## chunk", () => {
  const doc = `# Hotel

## Categorias de Quartos

### Suíte Standard Individual
- **Tamanho:** 12 m²

### Suíte Standard Duplo Casal
- **Tamanho:** 14 m²

## WiFi
- **Rede:** NET
`;
  const chunks = chunkKnowledgeDocumentContent(doc, { chunkSize: 2000, maxChunks: 20 });
  const roomsChunk = chunks.find((c) => c.includes("Categorias de Quartos"));
  assert.ok(roomsChunk);
  assert.ok(roomsChunk!.includes("### Suíte Standard Individual"));
  assert.ok(roomsChunk!.includes("### Suíte Standard Duplo Casal"));
  assert.ok(!chunks.some((c) => c.trim() === "### Suíte Standard Individual"));
});

test("extractMarkdownSectionForQuery aggregates ### room subsections under empty ## parent", () => {
  const q = "quais as categorias de quartos do hotel Brooklin?";
  const section = extractMarkdownSectionForQuery(BROOKLIN_ROOMS, q);
  assert.ok(section.includes("## Categorias de Quartos / Acomodações"));
  assert.ok(section.includes("### Suíte Standard Individual"));
  assert.ok(section.includes("### Suíte Standard Duplo Casal"));
  assert.ok(section.includes("### Suíte Standard Quadruplo"));
  assert.ok(section.includes("12 m²"));
  assert.equal(hasSubstantiveChunkBody(section), true);
  assert.equal(knowledgeContentCoversQuery(section, q), true);
});
