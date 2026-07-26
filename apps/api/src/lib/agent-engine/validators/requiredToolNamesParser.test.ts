import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRequiredToolNamesFromText,
  resolveRequiredToolNamesFromBehavior,
} from "./requiredToolNamesParser.js";

test("parseRequiredToolNamesFromText extracts mandatory buscar_conhecimento", () => {
  const names = parseRequiredToolNamesFromText(
    "Sempre use buscar_conhecimento antes de responder sobre quartos.",
  );
  assert.deepEqual(names, ["buscar_conhecimento"]);
});

test("parseRequiredToolNamesFromText ignores non-mandatory tool mentions", () => {
  const names = parseRequiredToolNamesFromText(
    "Pode usar buscar_conhecimento quando necessário.",
  );
  assert.deepEqual(names, []);
});

test("parseRequiredToolNamesFromText extracts oc_tool when mandatory", () => {
  const names = parseRequiredToolNamesFromText(
    "É obrigatório invocar `oc_tool_a1b2c3d4e5f6789012345678901234ab` antes de confirmar saldo.",
  );
  assert.equal(names.length, 1);
  assert.match(names[0]!, /^oc_tool_/);
});

test("parseRequiredToolNamesFromText extracts from restrictions block style", () => {
  const names = parseRequiredToolNamesFromText(
    "Deve consultar buscar_conhecimento para preços.\nNunca invente WiFi.",
  );
  assert.deepEqual(names, ["buscar_conhecimento"]);
});

test("resolveRequiredToolNamesFromBehavior reads promptBuilder blocks", () => {
  const names = resolveRequiredToolNamesFromBehavior({
    promptBuilder: {
      blocks: {
        restrictions: "Sempre invocar buscar_conhecimento para FAQ.",
        tools: "Opcional: call_human.",
        flows: "",
      },
    },
  });
  assert.deepEqual(names, ["buscar_conhecimento"]);
});

test("resolveRequiredToolNamesFromBehavior merges multiple blocks", () => {
  const names = resolveRequiredToolNamesFromBehavior({
    promptBuilder: {
      blocks: {
        restrictions: "",
        tools: "Obrigatório: call_human em escalada.",
        flows: "1. Deve usar transfer_to_team após falha.",
      },
    },
  });
  assert.ok(names.includes("call_human"));
  assert.ok(names.includes("transfer_to_team"));
});

test("resolveRequiredToolNamesFromBehavior returns empty for legacy config", () => {
  assert.deepEqual(resolveRequiredToolNamesFromBehavior({ nativeTools: {} }), []);
});
