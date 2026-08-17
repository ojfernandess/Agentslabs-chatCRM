import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conversationInboxVisibilityWhere } from "./conversationInboxVisibility.js";

describe("conversationInboxVisibilityWhere", () => {
  it("excludes trash and hidden email inboxes for admins", () => {
    const where = conversationInboxVisibilityWhere({
      organizationId: "org-1",
      hiddenEmailInboxIds: ["email-hidden"],
    });
    assert.equal(where.organizationId, "org-1");
    assert.equal(where.deletedAt, null);
    assert.equal(where.inboxId, undefined);
    assert.deepEqual(where.AND, [{ NOT: { inboxId: { in: ["email-hidden"] } } }]);
  });

  it("scopes agents to their inboxes and teams, keeping unteamed threads", () => {
    const where = conversationInboxVisibilityWhere({
      organizationId: "org-1",
      hiddenEmailInboxIds: [],
      agentInboxIds: ["inbox-a"],
      agentTeamIds: ["team-a"],
    });
    assert.deepEqual(where.inboxId, { in: ["inbox-a"] });
    assert.deepEqual(where.OR, [{ teamId: null }, { teamId: { in: ["team-a"] } }]);
  });

  it("returns empty inbox set when the agent has no memberships", () => {
    const where = conversationInboxVisibilityWhere({
      organizationId: "org-1",
      hiddenEmailInboxIds: [],
      agentInboxIds: [],
      agentTeamIds: [],
    });
    assert.deepEqual(where.inboxId, { in: [] });
    assert.deepEqual(where.OR, [{ teamId: null }]);
  });
});
