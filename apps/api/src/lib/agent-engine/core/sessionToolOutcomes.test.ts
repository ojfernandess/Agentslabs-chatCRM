import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_SATISFIED_TOOLS_KEY,
  appendSessionSatisfiedToolName,
  priorToolOutcomesFromSession,
  readSessionSatisfiedToolNames,
} from "../core/sessionToolOutcomes.js";

test("session satisfied tools round-trip in flowSlots", () => {
  let slots: Record<string, string | number | boolean> = {};
  slots = appendSessionSatisfiedToolName(slots, "embratur-reference");
  slots = appendSessionSatisfiedToolName(slots, "audaar_check_in");
  slots = appendSessionSatisfiedToolName(slots, "embratur-reference");

  assert.equal(readSessionSatisfiedToolNames(slots).length, 2);
  assert.ok(typeof slots[SESSION_SATISFIED_TOOLS_KEY] === "string");

  const prior = priorToolOutcomesFromSession(slots);
  assert.equal(prior.length, 2);
  assert.ok(prior.every((t) => t.ok));
});
