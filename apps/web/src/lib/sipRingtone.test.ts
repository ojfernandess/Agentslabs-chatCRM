import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSipRingtone } from "./sipRingtone.js";

test("normalizeSipRingtone keeps the current beep unless a known tone is selected", () => {
  assert.equal(normalizeSipRingtone(undefined), "classic");
  assert.equal(normalizeSipRingtone("nope"), "classic");
  assert.equal(normalizeSipRingtone("bright"), "bright");
  assert.equal(normalizeSipRingtone("pulse"), "pulse");
  assert.equal(normalizeSipRingtone("bell"), "bell");
  assert.equal(normalizeSipRingtone("urgent"), "urgent");
});
