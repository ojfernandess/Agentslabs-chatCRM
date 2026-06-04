import assert from "node:assert/strict";
import test from "node:test";
import { classifyBroadcastError, groupErrorsByCategory } from "./broadcastErrorClassifier.js";

test("classifyBroadcastError detects gateway and template messages", () => {
  assert.equal(classifyBroadcastError("Template not approved for Meta Cloud API").category, "template");
  assert.equal(classifyBroadcastError("Falha ao enviar pelo WhatsApp (Evolution)").category, "gateway");
  assert.equal(classifyBroadcastError("Skipped by flow condition").category, "flow_skip");
});

test("classifyBroadcastError returns unknown for empty", () => {
  assert.equal(classifyBroadcastError(null).category, "unknown");
  assert.equal(classifyBroadcastError("Something unexpected").category, "unknown");
});

test("groupErrorsByCategory aggregates counts and phones", () => {
  const grouped = groupErrorsByCategory(
    [
      { error: "WhatsApp delivery failed", phone: "+5511999990001" },
      { error: "Meta template missing", phone: "+5511999990002" },
      { error: "Invalid phone number", phone: "+5511888880001" },
      { error: "Invalid phone format", phone: "+5511888880002" },
    ],
    10,
  );
  assert.ok(grouped.some((g) => g.category === "template" && g.count >= 1));
  assert.ok(grouped.some((g) => g.category === "invalid_number" && g.count === 2));
  const invalid = grouped.find((g) => g.category === "invalid_number");
  assert.equal(invalid?.affectedPhones.length, 2);
});
