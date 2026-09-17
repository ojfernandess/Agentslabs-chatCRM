import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openConversationCountWhere } from "./assignableUsers.js";

describe("openConversationCountWhere", () => {
  it("scopes open counts to the active tenant only", () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const userIds = ["22222222-2222-4222-8222-222222222222"];

    assert.deepEqual(openConversationCountWhere(orgId, userIds), {
      organizationId: orgId,
      assignedToId: { in: userIds },
      status: "OPEN",
      deletedAt: null,
      inbox: { organizationId: orgId },
    });
  });
});
