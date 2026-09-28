import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyUsesNamedPlaceholders,
  bodyVariableCount,
  extractBodyPlaceholdersInOrder,
  substituteBodyPlaceholders,
} from "./templateVariables.js";

test("extractBodyPlaceholdersInOrder reads numbered placeholders", () => {
  assert.deepEqual(extractBodyPlaceholdersInOrder("Olá {{1}}, pedido {{2}}."), ["1", "2"]);
});

test("extractBodyPlaceholdersInOrder reads named placeholders", () => {
  assert.deepEqual(extractBodyPlaceholdersInOrder("Olá {{nome}}, pedido {{numero}}."), ["nome", "numero"]);
});

test("bodyVariableCount for numbered uses max index", () => {
  assert.equal(bodyVariableCount("A {{1}} B {{3}}"), 3);
});

test("bodyVariableCount for named uses token count", () => {
  assert.equal(bodyVariableCount("Olá {{nome}}, {{empresa}}."), 2);
});

test("bodyUsesNamedPlaceholders detects named tokens", () => {
  assert.equal(bodyUsesNamedPlaceholders("Olá {{nome}}"), true);
  assert.equal(bodyUsesNamedPlaceholders("Olá {{1}}"), false);
});

test("substituteBodyPlaceholders replaces named tokens in order", () => {
  const out = substituteBodyPlaceholders("Olá {{nome}}, pedido {{numero}}.", ["Maria", "#99"]);
  assert.equal(out, "Olá Maria, pedido #99.");
});

test("substituteBodyPlaceholders replaces numbered tokens", () => {
  const out = substituteBodyPlaceholders("Olá {{1}}, pedido {{2}}.", ["Maria", "#99"]);
  assert.equal(out, "Olá Maria, pedido #99.");
});
