import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_PLAYBOOK_MARKER, buildAgentPlaybookFromBlocks } from "../../agentPlaybook.js";
import { auditPromptAssembly } from "./promptAssemblyAudit.js";

test("auditPromptAssembly passes valid playbook system prompt", () => {
  const system = buildAgentPlaybookFromBlocks({
    personality: "",
    objective: "Atender hóspedes do hotel.",
    restrictions: "Nunca inventar preços.",
    tools: "Use buscar_conhecimento para FAQ.",
    memory: "",
    flows: "",
    fallback: "",
    examples: "",
  });
  const audit = auditPromptAssembly({ systemPrompt: system });
  assert.equal(audit.loadedCompletely, true);
  assert.equal(audit.duplicated, false);
  assert.equal(audit.playbookOrderOk, true);
  assert.equal(audit.restrictionsPresent, true);
});

test("auditPromptAssembly detects truncated prompt", () => {
  const audit = auditPromptAssembly({
    systemPrompt: `${AGENT_PLAYBOOK_MARKER}\nConteúdo cortado...`,
  });
  assert.equal(audit.truncated, true);
  assert.ok(audit.issues.some((i) => i.includes("truncado")));
});

test("auditPromptAssembly detects duplicate playbook marker", () => {
  const audit = auditPromptAssembly({
    systemPrompt: `${AGENT_PLAYBOOK_MARKER}\nA\n${AGENT_PLAYBOOK_MARKER}\nB`,
  });
  assert.equal(audit.duplicated, true);
});

test("auditPromptAssembly detects unresolved template variables", () => {
  const audit = auditPromptAssembly({
    systemPrompt: "Olá {{customer_name}}, bem-vindo.",
  });
  assert.equal(audit.variablesSubstituted, false);
});
