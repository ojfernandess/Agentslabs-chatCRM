import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRequiredToolNamesFromText,
  resolveRequiredToolNamesFromBehavior,
  resolveRequiredToolNamesForTurn,
  toolOutcomeSatisfiesRequired,
  parseCategoryToolMapFromPlaybook,
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

test("resolveRequiredToolNamesFromBehavior excludes escalation from static set", () => {
  const names = resolveRequiredToolNamesFromBehavior({
    promptBuilder: {
      blocks: {
        restrictions: "",
        tools: "Obrigatório: call_human em escalada.",
        flows: "1. Deve usar transfer_to_team após falha.",
      },
    },
  });
  assert.equal(names.includes("call_human"), false);
  assert.equal(names.includes("transfer_to_team"), false);
});

test("resolveRequiredToolNamesFromBehavior returns empty for legacy config", () => {
  assert.deepEqual(resolveRequiredToolNamesFromBehavior({ nativeTools: {} }), []);
});

test("parseCategoryToolMapFromPlaybook maps C8 to HTTP tool", () => {
  const map = parseCategoryToolMapFromPlaybook(`
| Categoria | Detectar | Acção | Tools |
| C8 | **CPF sozinho** | só 11 dígitos | Chame \`audaar_consultar_main_guest\` 1× | lookup |
| **C3** | \`audaar_consultar_reserva\` | localizador |
`);
  assert.ok((map.get("C8") ?? []).includes("audaar_consultar_main_guest"));
  assert.ok((map.get("C3") ?? []).includes("audaar_consultar_reserva"));
});

test("resolveRequiredToolNamesForTurn requires lookup on CPF-only message", () => {
  const behavior = {
    promptBuilder: {
      useFullPrompt: true,
      userCore: `
| Categoria | Detectar | Acção |
| C8 | CPF sozinho · 11 dígitos · lookup main guest | Chame \`audaar_consultar_main_guest\` |
| C7 | nacionalidade | ZERO tools |
| C3 | check-in · localizador | Chame \`audaar_consultar_reserva\` |
`,
    },
  };
  const names = resolveRequiredToolNamesForTurn(behavior, { userMessage: "41026299802" });
  assert.ok(
    names.some((n) => n.includes("consultar_main_guest") || n === "audaar_consultar_main_guest"),
    `expected main_guest tool, got ${JSON.stringify(names)}`,
  );
  assert.equal(names.some((n) => n.includes("consultar_reserva")), false);
});

test("resolveRequiredToolNamesForTurn requires reservation tool on check-in message", () => {
  const behavior = {
    promptBuilder: {
      useFullPrompt: true,
      userCore: `
| C3 | check-in · localizador | Chame \`hotel_consultar_reserva\` |
| C8 | CPF · 11 dígitos | Chame \`hotel_consultar_main_guest\` |
| S10 | check-in concluído | Chame \`hotel_check_in\` |
`,
    },
  };
  const names = resolveRequiredToolNamesForTurn(behavior, {
    userMessage: "quero fazer check-in 71CRUDTI",
  });
  assert.ok(names.some((n) => n.includes("consultar_reserva")));
  assert.equal(names.some((n) => /check_in$/i.test(n) && !/consultar/.test(n)), false);
  assert.equal(names.some((n) => n.includes("main_guest")), false);
});

test("resolveRequiredToolNamesForTurn does not require all playbook tools on check-in", () => {
  const playbook = `
| C3 | check-in · localizador | Chame \`audaar_consultar_reserva\` |
| C8 | CPF sozinho · 11 dígitos | Chame \`audaar_consultar_main_guest\` |
| C10 | selfie | Chame \`checkin_upload_selfie\` |
| S9 | embratur | Chame \`embratur-reference\` |
| S10 | Passo 8 | Chame \`audaar_check_in\` |
Sempre use buscar_conhecimento antes de responder sobre Wi-Fi.
`;
  const names = resolveRequiredToolNamesForTurn(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "fazer check-in na reserva 71CRUDTI" },
  );
  assert.deepEqual(
    names.filter((n) => n.includes("consultar_reserva") || n === "audaar_consultar_reserva"),
    names.length === 1 ? names : names.filter((n) => /consultar_reserva/i.test(n)),
  );
  assert.ok(names.length <= 2, `expected ≤2 required tools, got ${JSON.stringify(names)}`);
  assert.equal(names.includes("buscar_conhecimento"), false);
  assert.equal(names.some((n) => n.includes("selfie")), false);
  assert.equal(names.some((n) => n.includes("embratur")), false);
  assert.equal(names.some((n) => /audaar_check_in/i.test(n)), false);
});

test("resolveRequiredToolNamesForTurn requires reservation tool on consultar reserva message", () => {
  const playbook = `
| C2 | Verificar reserva | verificar/consultar + localizador | Chame \`audaar_consultar_reserva\` | consultar_reserva |
| C3 | Check-in explícito | fazer check-in + localizador | Chame \`audaar_consultar_reserva\` | consultar_reserva |
| C8 | CPF | 11 dígitos | Chame \`audaar_consultar_main_guest\` | lookup |
Sempre use buscar_conhecimento. Chame \`embratur-reference\`. Chame \`audaar_check_in\`.
`;
  const names = resolveRequiredToolNamesForTurn(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "pode consultar essa reserva QP7ZVTOG" },
  );
  assert.ok(names.some((n) => /consultar_reserva/i.test(n)), `got ${JSON.stringify(names)}`);
  assert.ok(names.length <= 2, `expected ≤2 tools, got ${JSON.stringify(names)}`);
  assert.equal(names.some((n) => /check_in$/i.test(n) && !/consultar/.test(n)), false);
  assert.equal(names.includes("buscar_conhecimento"), false);
});

test("resolveRequiredToolNamesForTurn does not fall back to all static tools on nationality", () => {
  const playbook = `
| C7 | Nacionalidade | brasileiro | ZERO |
| C8 | CPF | 11 dígitos | Chame \`audaar_consultar_main_guest\` |
Sempre use buscar_conhecimento. Chame \`audaar_check_in\`. Chame \`embratur-reference\`.
`;
  const names = resolveRequiredToolNamesForTurn(
    { promptBuilder: { useFullPrompt: true, userCore: playbook } },
    { userMessage: "brasileiro" },
  );
  assert.deepEqual(names, []);
});

test("resolveRequiredToolNamesForTurn is segment-agnostic for retail document id", () => {
  const behavior = {
    promptBuilder: {
      useFullPrompt: true,
      userCore: `
| C8 | CPF sozinho · 11 dígitos · documento lookup | Sempre use \`loja_consultar_cliente\` |
`,
    },
    availableToolNames: ["loja_consultar_cliente", "buscar_conhecimento"],
  };
  const names = resolveRequiredToolNamesForTurn(behavior, { userMessage: "12345678901" });
  assert.deepEqual(names.filter((n) => n.includes("consultar_cliente")), ["loja_consultar_cliente"]);
});

test("resolveRequiredToolNamesForTurn includes escalation only on complaint turn", () => {
  const behavior = {
    promptBuilder: {
      useFullPrompt: true,
      userCore: `
| C13 | reclamação · irritado | Chame \`call_human\` |
| C8 | CPF · 11 dígitos | Chame \`audaar_consultar_main_guest\` |
`,
    },
  };
  const onCpf = resolveRequiredToolNamesForTurn(behavior, { userMessage: "41026299802" });
  assert.equal(onCpf.includes("call_human"), false);

  const onComplaint = resolveRequiredToolNamesForTurn(behavior, {
    userMessage: "quero falar com um humano, péssimo atendimento",
  });
  assert.ok(onComplaint.includes("call_human"));
});

test("toolOutcomeSatisfiesRequired matches partial and preview alias", () => {
  assert.equal(
    toolOutcomeSatisfiesRequired("audaar_consultar_main_guest", [
      { name: "oc_tool_abc", preview: 'name":"audaar_consultar_main_guest"' },
    ]),
    true,
  );
  assert.equal(
    toolOutcomeSatisfiesRequired("consultar_main_guest", [
      { name: "audaar_consultar_main_guest", preview: "ok" },
    ]),
    true,
  );
  assert.equal(
    toolOutcomeSatisfiesRequired("audaar_consultar_main_guest", [{ name: "buscar_conhecimento", preview: "" }]),
    false,
  );
});

test("toolOutcomeSatisfiesRequired ignores failed outcomes", () => {
  assert.equal(
    toolOutcomeSatisfiesRequired("audaar_check_in", [
      { name: "audaar_check_in", preview: "error", ok: false },
    ]),
    false,
  );
  assert.equal(
    toolOutcomeSatisfiesRequired("audaar_check_in", [
      { name: "audaar_check_in", preview: "ok", ok: true },
    ]),
    true,
  );
});

test("resolveRequiredToolNamesForTurn does not require check_in on ficha form", () => {
  const behavior = {
    promptBuilder: {
      useFullPrompt: true,
      userCore: `
| S9 | ficha | Chame \`audaar_consultar_main_guest\` |
| S10 | após ficha + sim | Chame \`audaar_check_in\` · PROIBIDO \`embratur-reference\` |
`,
    },
  };
  const names = resolveRequiredToolNamesForTurn(behavior, {
    userMessage:
      "* Motivo da viagem: Congresso\n* Meio de transporte: Automóvel\n* País de residência: Brasil\n* País de destino: Brasil",
  });
  assert.equal(
    names.some((n) => /check[_-]?in/i.test(n)),
    false,
    `ficha must not require check_in, got ${JSON.stringify(names)}`,
  );
});
