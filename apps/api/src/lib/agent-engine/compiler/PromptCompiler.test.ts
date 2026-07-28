import assert from "node:assert/strict";
import test from "node:test";
import { compilePromptContract } from "./PromptCompiler.js";

test("compilePromptContract extracts required tools from playbook blocks", () => {
  const contract = compilePromptContract({
    behaviorConfig: {
      promptBuilder: {
        blocks: {
          restrictions: "",
          tools: "",
          flows: "| C3 | check-in localizador | audaar_consultar_reserva |",
        },
      },
    },
    userMessage: "quero fazer check-in ABC12345",
  });
  assert.ok(contract.requiredToolNames.includes("audaar_consultar_reserva"));
  assert.equal(contract.version, 1);
  assert.ok(contract.promptHash.length >= 8);
  assert.ok(contract.objective.length > 0);
});

test("compilePromptContract is idempotent for same inputs", () => {
  const behaviorConfig = {
    promptBuilder: {
      userCore: "Objetivo: atender hóspedes.\nSempre use buscar_conhecimento para FAQ.",
    },
  };
  const a = compilePromptContract({ behaviorConfig, userMessage: "wifi?" });
  const b = compilePromptContract({ behaviorConfig, userMessage: "wifi?" });
  assert.equal(a.promptHash, b.promptHash);
  assert.deepEqual(a.requiredToolNames, b.requiredToolNames);
});
