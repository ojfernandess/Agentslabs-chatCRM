import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLayerSpans,
  isLangfuseConfigured,
  readLangfuseConfig,
  resolveRuntimeLayer,
} from "./LangfuseBridge.js";

test("isLangfuseConfigured false without env", () => {
  const prevPk = process.env.LANGFUSE_PUBLIC_KEY;
  const prevSk = process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  assert.equal(isLangfuseConfigured(), false);
  assert.equal(readLangfuseConfig(), null);
  if (prevPk) process.env.LANGFUSE_PUBLIC_KEY = prevPk;
  if (prevSk) process.env.LANGFUSE_SECRET_KEY = prevSk;
});

test("resolveRuntimeLayer maps graph nodes to layers", () => {
  assert.equal(resolveRuntimeLayer("schedule_tools"), "scheduler");
  assert.equal(resolveRuntimeLayer("validate_result"), "contract");
  assert.equal(resolveRuntimeLayer("turn_context"), "prompt_compiler");
  assert.equal(resolveRuntimeLayer("retry"), "resilience");
});

test("buildLayerSpans creates one span per layer", () => {
  const spans = buildLayerSpans(
    "trace-1",
    [
      {
        id: "load_memory",
        name: "memory",
        status: "ok",
        startedAt: "2026-07-28T10:00:00.000Z",
        endedAt: "2026-07-28T10:00:01.000Z",
      },
      {
        id: "schedule_tools",
        name: "scheduler",
        status: "ok",
        startedAt: "2026-07-28T10:00:01.000Z",
        endedAt: "2026-07-28T10:00:02.000Z",
      },
      {
        id: "validate_result",
        name: "validate",
        status: "ok",
        startedAt: "2026-07-28T10:00:03.000Z",
        endedAt: "2026-07-28T10:00:04.000Z",
      },
    ],
    [{ kind: "turn_context", at: "2026-07-28T10:00:00.500Z", detail: "compiled" }],
    {
      version: 1,
      userMessage: "check-in",
      requiredToolNames: ["audaar_consultar_reserva"],
      pendingToolNames: [],
      satisfiedToolNames: ["audaar_consultar_reserva"],
      forbiddenToolNames: [],
      contractValid: true,
      violations: [],
      intentKind: "operational_action",
      promptHash: "abc",
    },
  );
  const names = spans.map((s) => s.body.name);
  assert.ok(names.includes("layer/memory"));
  assert.ok(names.includes("layer/scheduler"));
  assert.ok(names.includes("layer/contract"));
  assert.ok(names.includes("layer/prompt_compiler"));
});
