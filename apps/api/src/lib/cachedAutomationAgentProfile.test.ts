import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithAgentTurnLookupCache } from "./cachedAutomationAgentProfile.js";

describe("cachedAutomationAgentProfile", () => {
  it("reuses parent scope when nested", async () => {
    let outer = false;
    let inner = false;
    await runWithAgentTurnLookupCache("bot-1", async () => {
      outer = true;
      await runWithAgentTurnLookupCache("bot-1", async () => {
        inner = true;
      });
    });
    assert.equal(outer, true);
    assert.equal(inner, true);
  });
});
