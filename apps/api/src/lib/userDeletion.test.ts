import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reassignUserRestrictReferences } from "./userDeletion.js";

function createTxMock() {
  const calls: Array<{ model: string; where: unknown; data: unknown }> = [];
  const updateMany = (model: string) =>
    async (args: { where: unknown; data: unknown }) => {
      calls.push({ model, where: args.where, data: args.data });
      return { count: 1 };
    };

  return {
    calls,
    tx: {
      auditLog: { updateMany: updateMany("auditLog") },
      platformApplication: { updateMany: updateMany("platformApplication") },
      broadcastCampaign: { updateMany: updateMany("broadcastCampaign") },
      automationKnowledgeRevision: { updateMany: updateMany("automationKnowledgeRevision") },
      userInvitation: { updateMany: updateMany("userInvitation") },
      conversationClosureRecord: { updateMany: updateMany("conversationClosureRecord") },
    },
  };
}

describe("reassignUserRestrictReferences", () => {
  it("updates all restrict FK tables before user delete", async () => {
    const { tx, calls } = createTxMock();

    await reassignUserRestrictReferences(tx as never, "user-a", "user-b");

    assert.equal(calls.length, 6);
    assert.deepEqual(calls[0], {
      model: "auditLog",
      where: { actorUserId: "user-a" },
      data: { actorUserId: "user-b" },
    });
    assert.ok(calls.some((c) => c.model === "userInvitation"));
    assert.ok(calls.some((c) => c.model === "conversationClosureRecord"));
  });

  it("skips when reassign target is the same user", async () => {
    const { tx, calls } = createTxMock();

    await reassignUserRestrictReferences(tx as never, "user-a", "user-a");

    assert.equal(calls.length, 0);
  });
});
