import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "../types.js";
import type { AgentRuntimeExecuteInput } from "../types.js";
import { UnifiedSpineSession } from "./UnifiedSpineBridge.js";
import { resolveSpineBoundTurnContext } from "./spineTurnContextBindings.js";

test("resolveSpineBoundTurnContext only mode uses engine without legacy builder", () => {
  const input = {
    organizationId: "org",
    bot: { id: "bot" } as AgentRuntimeExecuteInput["bot"],
    conversation: { id: "conv" } as AgentRuntimeExecuteInput["conversation"],
    message: { id: "msg", body: "sim", direction: "INBOUND" } as AgentRuntimeExecuteInput["message"],
    log: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} } as AgentRuntimeExecuteInput["log"],
    engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, unifiedSpineMode: "only" },
    llmConfig: {},
    behaviorConfig: {
      promptBuilder: { userCore: "Fluxo check-in hotel." },
    },
  } satisfies AgentRuntimeExecuteInput;

  const session = UnifiedSpineSession.begin({ input, memory: {} });
  const ctx = resolveSpineBoundTurnContext(
    session,
    {
      turnId: "conv:msg",
      behaviorConfig: input.behaviorConfig,
      userMessage: "sim",
      availableToolNames: [],
      toolOutcomes: [],
      toolConfigs: [],
      memory: {},
      sessionPriorOutcomes: [],
    },
  );
  assert.equal(session.lastResolutionSource, "engine");
  assert.ok(ctx.promptIr.metadata.hash);
  assert.equal(ctx.userMessage, "sim");
});
