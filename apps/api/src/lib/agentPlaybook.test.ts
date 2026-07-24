import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PLAYBOOK_MARKER,
  applyAgentPlaybookToSystemInstructions,
  buildAgentPlaybookFromBlocks,
  emptyPromptBlocks,
} from "./agentPlaybook.js";
import { mergeSystemWithAutoBlock } from "./agentPromptSync.js";

test("buildAgentPlaybookFromBlocks orders objective before restrictions before personality", () => {
  const md = buildAgentPlaybookFromBlocks({
    ...emptyPromptBlocks(),
    personality: "Cordial",
    objective: "Atender",
    restrictions: "Nunca inventar",
  });
  assert.ok(md.indexOf("## Objetivo") < md.indexOf("## Restrições (obrigatório"));
  assert.ok(md.indexOf("## Restrições") < md.indexOf("## Personalidade"));
});

test("applyAgentPlaybookToSystemInstructions remounts blocks and preserves auto-prompt", () => {
  const flatCore = "Atender hóspedes.\n\n---\n\nNunca inventar.\n\n---\n\nCordial.";
  const autoInner =
    "Instruções automáticas (sincronizadas pelo OpenConduit)\n\nPer custom tool — agent instructions:\n- Tool X: use oc_tool_abc";
  const stored = mergeSystemWithAutoBlock(flatCore, autoInner);

  const next = applyAgentPlaybookToSystemInstructions(stored, {
    useFullPrompt: false,
    blocks: {
      ...emptyPromptBlocks(),
      objective: "Atender hóspedes.",
      restrictions: "Nunca informe dados da reserva sem consultar a ferramenta.",
      tools: "getReservation()",
      fallback: "Solicite o localizador.",
      personality: "Cordial.",
    },
  });

  assert.ok(next.includes(AGENT_PLAYBOOK_MARKER));
  assert.match(next, /## Objetivo/);
  assert.match(next, /obrigatório — cumprir sempre/);
  assert.match(next, /getReservation/);
  assert.match(next, /openconduit:auto-prompt/);
  assert.match(next, /Per custom tool — agent instructions/);
  assert.match(next, /Tool X: use oc_tool_abc/);
  assert.ok(!next.includes("---\n\nNunca inventar"));
});

test("applyAgentPlaybookToSystemInstructions envelopes full prompt without rewriting body", () => {
  const body = "Você é o concierge. Sempre confirme o localizador.";
  const next = applyAgentPlaybookToSystemInstructions(body, {
    useFullPrompt: true,
    userCore: body,
    blocks: emptyPromptBlocks(),
  });
  assert.ok(next.includes(AGENT_PLAYBOOK_MARKER));
  assert.match(next, /concierge/);
  const again = applyAgentPlaybookToSystemInstructions(next, {
    useFullPrompt: true,
    userCore: body,
    blocks: emptyPromptBlocks(),
  });
  assert.equal(again, next);
});
