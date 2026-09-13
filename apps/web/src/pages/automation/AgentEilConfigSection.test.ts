import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentEilForPayload,
  parseAgentEilJson,
  agentEilIsActive,
  agentEilPoliciesToJson,
  DEFAULT_AGENT_EIL_JSON,
  EMPTY_AGENT_EIL_JSON,
} from "./AgentEilConfigSection.js";

test("parseAgentEilJson accepts default EIL policy bundle", () => {
  const parsed = parseAgentEilJson(DEFAULT_AGENT_EIL_JSON);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.summary.policies, 1);
    assert.equal(parsed.summary.policyIds[0], "party_requires_n_gt_1");
  }
});

test("parseAgentEilJson accepts empty policies", () => {
  const parsed = parseAgentEilJson(EMPTY_AGENT_EIL_JSON);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.summary.policies, 0);
});

test("agentEilPoliciesToJson returns empty bundle when no policies", () => {
  assert.equal(agentEilPoliciesToJson({ policies: [] }), EMPTY_AGENT_EIL_JSON);
});

test("buildAgentEilForPayload skips eil when disabled and no policies", () => {
  assert.equal(buildAgentEilForPayload(false, "{}"), null);
});

test("buildAgentEilForPayload persists disabled with policies", () => {
  const payload = buildAgentEilForPayload(false, DEFAULT_AGENT_EIL_JSON);
  assert.equal(payload?.enabled, false);
  assert.equal(payload?.policies?.[0]?.id, "party_requires_n_gt_1");
});

test("agentEilIsActive respects enabled flag", () => {
  assert.equal(agentEilIsActive({ eil: { enabled: true, policies: [] } }), true);
  assert.equal(agentEilIsActive({ eil: { enabled: false, policies: [] } }), false);
  assert.equal(agentEilIsActive({}), false);
});

test("parseAgentEilJson preserves UI metadata on policies", () => {
  const raw = JSON.stringify({
    policies: [
      {
        id: "test_policy",
        action: "confirm",
        name: "Teste",
        description: "Desc",
        active: false,
        onUnknown: "fetch",
      },
    ],
  });
  const parsed = parseAgentEilJson(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const p = parsed.value.policies?.[0];
    assert.equal(p?.name, "Teste");
    assert.equal(p?.active, false);
    assert.equal(p?.onUnknown, "fetch");
  }
});
