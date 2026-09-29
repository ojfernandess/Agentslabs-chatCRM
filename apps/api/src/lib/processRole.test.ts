import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseProcessRole,
  runsAgentEngineWorker,
  runsBackgroundSchedulers,
  runsGeneralQueueWorkers,
  runsHttpApi,
  runsPresenceSweep,
  runsQueueWorkers,
} from "./processRole.js";

test("parseProcessRole defaults to all", () => {
  assert.equal(parseProcessRole(undefined), "all");
  assert.equal(parseProcessRole(""), "all");
  assert.equal(parseProcessRole("ALL"), "all");
});

test("parseProcessRole reads api, worker and agent-worker", () => {
  assert.equal(parseProcessRole("api"), "api");
  assert.equal(parseProcessRole(" worker "), "worker");
  assert.equal(parseProcessRole("agent-worker"), "agent-worker");
});

test("process role capability matrix", () => {
  assert.equal(runsHttpApi("all"), true);
  assert.equal(runsHttpApi("api"), true);
  assert.equal(runsHttpApi("worker"), false);

  assert.equal(runsQueueWorkers("worker"), true);
  assert.equal(runsQueueWorkers("agent-worker"), true);
  assert.equal(runsQueueWorkers("api"), false);

  assert.equal(runsGeneralQueueWorkers("worker"), true);
  assert.equal(runsGeneralQueueWorkers("agent-worker"), false);

  assert.equal(runsAgentEngineWorker("agent-worker"), true);
  assert.equal(runsAgentEngineWorker("api"), false);

  const prevDedicated = process.env.AGENT_ENGINE_DEDICATED_WORKER;
  process.env.AGENT_ENGINE_DEDICATED_WORKER = "true";
  assert.equal(runsAgentEngineWorker("worker"), false);
  process.env.AGENT_ENGINE_DEDICATED_WORKER = "false";
  assert.equal(runsAgentEngineWorker("worker"), true);
  if (prevDedicated === undefined) delete process.env.AGENT_ENGINE_DEDICATED_WORKER;
  else process.env.AGENT_ENGINE_DEDICATED_WORKER = prevDedicated;

  assert.equal(runsBackgroundSchedulers("worker"), true);
  assert.equal(runsBackgroundSchedulers("agent-worker"), false);
  assert.equal(runsBackgroundSchedulers("api"), false);

  assert.equal(runsPresenceSweep("api"), true);
  assert.equal(runsPresenceSweep("worker"), false);
});
