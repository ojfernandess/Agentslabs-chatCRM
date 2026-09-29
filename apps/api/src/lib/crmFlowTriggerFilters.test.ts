import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCrmFlowDispatchWhere,
  crmFlowTriggerMatches,
} from "./crmFlowTriggerFilters.js";

test("crmFlowTriggerMatches respects trigger type", () => {
  assert.equal(crmFlowTriggerMatches({ type: "message_received" }, "message_received", {}), true);
  assert.equal(crmFlowTriggerMatches({ type: "message_received" }, "lead_created", {}), false);
  assert.equal(crmFlowTriggerMatches({}, "lead_created", {}), true);
});

test("buildCrmFlowDispatchWhere filters message_received in DB", () => {
  const where = buildCrmFlowDispatchWhere("org-1", "message_received");
  assert.equal(where.organizationId, "org-1");
  assert.equal(where.status, "ACTIVE");
  assert.equal(where.isPublished, true);
  assert.deepEqual(where.triggerConfig, { path: ["type"], equals: "message_received" });
});

test("buildCrmFlowDispatchWhere keeps lead_created legacy OR", () => {
  const where = buildCrmFlowDispatchWhere("org-1", "lead_created");
  assert.ok(Array.isArray(where.OR));
  assert.equal(where.OR?.length, 2);
});
