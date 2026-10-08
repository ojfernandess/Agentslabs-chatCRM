import assert from "node:assert/strict";
import test from "node:test";
import { distributionCallerKey, pickLeastCallsAgent, saoPauloDayStart } from "./sipCallDistribution.js";

test("pickLeastCallsAgent draws only among the agents with the fewest offers", () => {
  const agents = [
    { userId: "ana", offeredToday: 6 },
    { userId: "joao", offeredToday: 8 },
    { userId: "maria", offeredToday: 3 },
    { userId: "pedro", offeredToday: 3 },
  ];
  assert.equal(pickLeastCallsAgent(agents, () => 0), "maria");
  assert.equal(pickLeastCallsAgent(agents, () => 0.99), "pedro");
  assert.equal(pickLeastCallsAgent([{ userId: "maria", offeredToday: 3 }], () => 0.4), "maria");
  assert.equal(pickLeastCallsAgent([], () => 0), null);
});

test("saoPauloDayStart follows the calendar day in Sao Paulo", () => {
  assert.equal(saoPauloDayStart(new Date("2026-10-08T02:00:00.000Z")).toISOString(), "2026-10-07T03:00:00.000Z");
  assert.equal(saoPauloDayStart(new Date("2026-10-08T15:00:00.000Z")).toISOString(), "2026-10-08T03:00:00.000Z");
});

test("distributionCallerKey ignores the local extension", () => {
  assert.equal(distributionCallerKey("+5511988776655", "110937011"), "5511988776655");
  assert.equal(distributionCallerKey("110937011", "110937011"), "anonymous");
  assert.equal(distributionCallerKey("123", "110937011"), "anonymous");
});
