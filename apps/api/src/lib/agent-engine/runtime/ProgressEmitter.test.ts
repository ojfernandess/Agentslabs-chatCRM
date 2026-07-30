import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveActProgressMessage } from "./ProgressEmitter.js";

test("resolveActProgressMessage disabled in runtime_owned", () => {
  const r = resolveActProgressMessage({
    toolExecutionMode: "runtime_owned",
    plannedToolNames: ["audaar_consultar_reserva"],
    behaviorConfig: { toolCallNotify: { enabled: true, message: "Aguarde…" } },
  });
  assert.equal(r.shouldEmit, false);
});

test("resolveActProgressMessage emits in hybrid when enabled", () => {
  const r = resolveActProgressMessage({
    toolExecutionMode: "hybrid",
    plannedToolNames: ["audaar_consultar_reserva"],
    behaviorConfig: { toolCallNotify: { enabled: true, message: "Aguarde…" } },
  });
  assert.equal(r.shouldEmit, true);
  assert.equal(r.message, "Aguarde…");
});

test("resolveActProgressMessage no emit without planned tools", () => {
  const r = resolveActProgressMessage({
    toolExecutionMode: "hybrid",
    plannedToolNames: [],
    behaviorConfig: { toolCallNotify: { enabled: true } },
  });
  assert.equal(r.shouldEmit, false);
});
