import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCachedAgentBotDispatchContext,
  resetAgentBotDispatchContextCacheForTests,
  setCachedAgentBotDispatchContext,
} from "./agentBotDispatchContextCache.js";

test("agentBotDispatchContextCache stores and returns value within TTL", () => {
  resetAgentBotDispatchContextCacheForTests();
  const ctx = {
    agentBotId: "bot-1",
    agentBot: { id: "bot-1", isActive: true } as import("@prisma/client").Bot,
  };
  setCachedAgentBotDispatchContext("org-1", "inbox-1", ctx);
  assert.deepEqual(getCachedAgentBotDispatchContext("org-1", "inbox-1"), ctx);
  assert.equal(getCachedAgentBotDispatchContext("org-1", "inbox-2"), undefined);
});
