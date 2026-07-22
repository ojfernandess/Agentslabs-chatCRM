import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksToStructuredMarkdown,
  countFilledPromptBlocks,
  improvePromptFromMarkdown,
  parseMarkdownPromptIntoBlocks,
} from "./promptBlocks.js";

test("parseMarkdownPromptIntoBlocks fills personality and objective from headings", () => {
  const blocks = parseMarkdownPromptIntoBlocks(`## Personalidade
Tom empático e claro.

## Objetivo
Qualificar o lead.

## Restrições
- Não inventar preços.
`);
  assert.equal(blocks.personality, "Tom empático e claro.");
  assert.equal(blocks.objective, "Qualificar o lead.");
  assert.match(blocks.restrictions, /Não inventar/);
  assert.equal(countFilledPromptBlocks(blocks), 3);
});

test("improvePromptFromMarkdown restructures without inventing content", () => {
  const { blocks, structuredMarkdown, filledCount } = improvePromptFromMarkdown(
    `Prefácio do hotel.\n\n## Persona\nRecepcionista digital.\n\n## Goal\nConfirmar reserva.`,
  );
  assert.ok(filledCount >= 2);
  assert.match(blocks.personality, /Recepcionista/);
  assert.match(blocks.objective, /Confirmar reserva/);
  assert.match(structuredMarkdown, /## Personalidade/);
  assert.match(structuredMarkdown, /## Objetivo/);
});

test("blocksToStructuredMarkdown uses canonical headings", () => {
  const md = blocksToStructuredMarkdown({
    personality: "A",
    objective: "B",
    restrictions: "",
    tools: "",
    memory: "",
    flows: "",
    fallback: "",
    examples: "",
  });
  assert.equal(md, "## Personalidade\nA\n\n## Objetivo\nB");
});
