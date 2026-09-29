import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCachedAutomationConversationContextRow,
  getCachedOrganizationFeatureEnabled,
  getCachedInteractionBudgetRow,
  getCachedRankedKnowledgeSearch,
  primeCachedAutomationConversationContext,
  primeCachedInteractionBudgetRow,
  runWithAgentTurnLookupCache,
} from "./cachedAutomationAgentProfile.js";

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

  it("deduplicates feature flag resolution within the same agent turn", async () => {
    let calls = 0;
    const resolve = async () => {
      calls += 1;
      return true;
    };

    await runWithAgentTurnLookupCache("bot-1", async () => {
      const first = await getCachedOrganizationFeatureEnabled("org-1", "crm_kanban", resolve);
      const second = await getCachedOrganizationFeatureEnabled("org-1", "crm_kanban", resolve);
      assert.equal(first, true);
      assert.equal(second, true);
      assert.equal(calls, 1);
    });
  });

  it("does not share feature flag cache across separate agent turns", async () => {
    let calls = 0;
    const resolve = async () => {
      calls += 1;
      return false;
    };

    await runWithAgentTurnLookupCache("bot-1", () =>
      getCachedOrganizationFeatureEnabled("org-1", "crm_kanban", resolve),
    );
    await runWithAgentTurnLookupCache("bot-1", () =>
      getCachedOrganizationFeatureEnabled("org-1", "crm_kanban", resolve),
    );
    assert.equal(calls, 2);
  });

  it("returns primed conversation context without a second loader", async () => {
    const primed = {
      organizationId: "org-1",
      conversationId: "conv-1",
      botId: "bot-1",
      state: { flowSlots: { step: "a" } },
      lastClearedAt: null,
    };

    await runWithAgentTurnLookupCache("bot-1", async () => {
      primeCachedAutomationConversationContext("conv-1", primed);
      const row = await getCachedAutomationConversationContextRow("conv-1");
      assert.deepEqual(row, primed);
    });
  });

  it("deduplicates ranked knowledge search within the same agent turn", async () => {
    let calls = 0;
    const resolve = async () => {
      calls += 1;
      return { ranked: [{ id: "a" }], mode: "lexical" as const };
    };

    await runWithAgentTurnLookupCache("bot-1", async () => {
      const first = await getCachedRankedKnowledgeSearch("org:bot:q:5", resolve);
      const second = await getCachedRankedKnowledgeSearch("org:bot:q:5", resolve);
      assert.equal(first.mode, "lexical");
      assert.equal(second.mode, "lexical");
      assert.equal(calls, 1);
    });
  });

  it("reuses primed interaction budget row without a second loader", async () => {
    await runWithAgentTurnLookupCache("bot-1", async () => {
      primeCachedInteractionBudgetRow("conv-1", { interactionCount: 3, status: "ACTIVE" });
      const row = await getCachedInteractionBudgetRow("conv-1");
      assert.deepEqual(row, { interactionCount: 3, status: "ACTIVE" });
    });
  });

  it("replaces conversation context cache after prime (upsert invalidation)", async () => {
    await runWithAgentTurnLookupCache("bot-1", async () => {
      primeCachedAutomationConversationContext("conv-1", {
        organizationId: "org-1",
        conversationId: "conv-1",
        botId: "bot-1",
        state: { nativeTurn: { lastPreview: "old" } },
        lastClearedAt: null,
      });

      primeCachedAutomationConversationContext("conv-1", {
        organizationId: "org-1",
        conversationId: "conv-1",
        botId: "bot-1",
        state: { nativeTurn: { lastPreview: "new" } },
        lastClearedAt: null,
      });

      const row = await getCachedAutomationConversationContextRow("conv-1");
      assert.equal(
        (row?.state as { nativeTurn?: { lastPreview?: string } }).nativeTurn?.lastPreview,
        "new",
      );
    });
  });
});
