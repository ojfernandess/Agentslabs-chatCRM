import assert from "node:assert/strict";
import test from "node:test";
import { canClaimSipTab, parseSipTabOwner } from "./sipTabOwner.js";

test("parseSipTabOwner ignores malformed records", () => {
  assert.equal(parseSipTabOwner(null), null);
  assert.equal(parseSipTabOwner("{"), null);
  assert.equal(parseSipTabOwner(JSON.stringify({ tabId: "", at: 1 })), null);
});

test("canClaimSipTab keeps a live owner and takes over a stale one", () => {
  const owner = { tabId: "a", at: 1_000 };
  assert.equal(canClaimSipTab(2_000, null, "b"), true);
  assert.equal(canClaimSipTab(2_000, owner, "a"), true);
  assert.equal(canClaimSipTab(2_000, owner, "b"), false);
  assert.equal(canClaimSipTab(5_000, owner, "b"), true);
});
