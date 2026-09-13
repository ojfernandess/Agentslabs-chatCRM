import assert from "node:assert/strict";
import test from "node:test";
import { inferToolEilFromSchema, parseParametersSchema } from "./inferToolEilFromSchema.js";

test("parseParametersSchema reads OpenAI object schema", () => {
  const props = parseParametersSchema({
    type: "object",
    properties: {
      reservationId: { type: "string" },
      cpf: { type: "string" },
    },
    required: ["reservationId"],
  });
  assert.equal(props.length, 2);
  assert.equal(props.find((p) => p.name === "reservationId")?.required, true);
});

test("inferToolEilFromSchema applies reservation preset by tool name", () => {
  const result = inferToolEilFromSchema({
    toolName: "consultar_reserva",
    parametersSchema: { type: "object", properties: {} },
  });
  assert.ok(result.summary.fromPreset);
  assert.ok(result.draft.produces?.includes("guestsQuantity"));
  assert.ok(result.draft.capabilities?.includes("lookup_reservation"));
});

test("inferToolEilFromSchema maps required params to requiresFacts", () => {
  const result = inferToolEilFromSchema({
    toolName: "minha_ferramenta",
    parametersSchema: {
      type: "object",
      properties: {
        cpf: { type: "string" },
        query: { type: "string" },
        email: { type: "string" },
      },
      required: ["cpf", "email"],
    },
  });
  assert.ok(result.draft.requiresFacts?.includes("documentNumber"));
  assert.ok(result.draft.requiresFacts?.includes("email"));
  assert.equal(result.draft.requiresFacts?.includes("query"), false);
});

test("inferToolEilFromSchema merges with existing config", () => {
  const result = inferToolEilFromSchema({
    toolName: "custom_tool",
    parametersSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    existing: { produces: ["customFact"], capabilities: ["existing_cap"] },
  });
  assert.ok(result.draft.produces?.includes("customFact"));
  assert.ok(result.draft.capabilities?.includes("existing_cap"));
  assert.ok(result.draft.requiresFacts?.includes("orderId"));
});
