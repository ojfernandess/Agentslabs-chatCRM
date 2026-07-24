import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PLAYBOOK_MARKER,
  blocksToStructuredMarkdown,
  buildAgentPlaybookFromBlocks,
  buildAgentPlaybookFromFullPrompt,
  buildAgentUserCoreForPersist,
  countFilledPromptBlocks,
  emptyPromptBlocks,
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

test("parseMarkdownPromptIntoBlocks maps Regras obrigatórias to restrictions", () => {
  const blocks = parseMarkdownPromptIntoBlocks(`## Objetivo
Atender hóspedes.

## Regras obrigatórias
Nunca informe dados da reserva sem consultar a ferramenta.

## Fallback
Solicite o localizador.
`);
  assert.match(blocks.restrictions, /Nunca informe/);
  assert.match(blocks.fallback, /localizador/);
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
  assert.ok(structuredMarkdown.includes(AGENT_PLAYBOOK_MARKER));
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

test("buildAgentPlaybookFromBlocks prioritizes objective and MUST FOLLOW restrictions", () => {
  const md = buildAgentPlaybookFromBlocks({
    ...emptyPromptBlocks(),
    personality: "Tom cordial.",
    objective: "Atender hóspedes.",
    restrictions: "Nunca informe dados da reserva sem consultar a ferramenta.",
    tools: "getReservation()",
    fallback: "Solicite o localizador.",
  });
  assert.ok(md.includes(AGENT_PLAYBOOK_MARKER));
  const objIdx = md.indexOf("## Objetivo");
  const restIdx = md.indexOf("## Restrições (obrigatório — cumprir sempre)");
  const toolsIdx = md.indexOf("## Ferramentas");
  const persIdx = md.indexOf("## Personalidade");
  assert.ok(objIdx > 0);
  assert.ok(restIdx > objIdx);
  assert.ok(toolsIdx > restIdx);
  assert.ok(persIdx > toolsIdx);
  assert.match(md, /Nunca informe dados da reserva/);
  assert.match(md, /getReservation/);
  assert.match(md, /localizador/);
});

test("buildAgentPlaybookFromFullPrompt is idempotent", () => {
  const once = buildAgentPlaybookFromFullPrompt("Atenda o cliente com empatia.");
  assert.ok(once.includes(AGENT_PLAYBOOK_MARKER));
  assert.match(once, /Atenda o cliente/);
  const twice = buildAgentPlaybookFromFullPrompt(once);
  assert.equal(twice, once);
});

test("buildAgentUserCoreForPersist uses playbook in block mode", () => {
  const core = buildAgentUserCoreForPersist({
    useFullPrompt: false,
    blocks: {
      ...emptyPromptBlocks(),
      objective: "Atender hóspedes.",
      restrictions: "Nunca inventar dados.",
    },
    fullPrompt: "",
  });
  assert.match(core, /## Objetivo/);
  assert.match(core, /obrigatório/);
});
