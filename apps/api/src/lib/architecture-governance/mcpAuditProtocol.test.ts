import assert from "node:assert/strict";
import { test } from "node:test";
import {
  verifySpinePipeline,
  verifyMcpAuditBatch,
  POST_REconstruction_MCP_SAMPLES,
} from "./mcpAuditProtocol.js";

test("verifySpinePipeline detects layers in simulator sample", () => {
  const v = verifySpinePipeline(POST_REconstruction_MCP_SAMPLES[0]!);
  assert.ok(v.layersPresent.includes("prompt_compiler"));
  assert.ok(v.layersPresent.includes("contract"));
  assert.equal(v.complete, true);
});

test("verifyMcpAuditBatch counts pipeline complete samples", () => {
  const batch = verifyMcpAuditBatch(POST_REconstruction_MCP_SAMPLES);
  assert.ok(batch.pipelineComplete >= 1);
});
