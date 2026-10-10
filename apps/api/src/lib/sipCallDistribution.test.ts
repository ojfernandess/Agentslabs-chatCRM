import assert from "node:assert/strict";
import test from "node:test";
import {
  distributionCallerKey,
  leastCallsPriorityPool,
  pickLeastCallsAgent,
  resolveDistributionAgentStatus,
  saoPauloDayStart,
  summarizeDistributionDay,
} from "./sipCallDistribution.js";

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

test("leastCallsPriorityPool lists every tied agent and does not draw", () => {
  const pool = leastCallsPriorityPool([
    { userId: "ana", offeredToday: 8 },
    { userId: "pedro", offeredToday: 5 },
    { userId: "maria", offeredToday: 5 },
  ]);
  assert.deepEqual(pool.map((agent) => agent.userId), ["maria", "pedro"]);
});

test("summarizeDistributionDay counts one call when it is offered twice", () => {
  const summary = summarizeDistributionDay([
    { userId: "maria", callerDigits: "5511999998888", sipCallId: "invite-1", offeredAtMs: 1_000, answered: false },
    { userId: "pedro", callerDigits: "5511999998888", sipCallId: "invite-2", offeredAtMs: 20_000, answered: true },
    { userId: "maria", callerDigits: "5511999998888", sipCallId: "invite-1", offeredAtMs: 1_500, answered: false },
    { userId: "ana", callerDigits: "5511888777666", sipCallId: "invite-3", offeredAtMs: 400_000, answered: false },
  ]);
  assert.equal(summary.received, 2);
  assert.equal(summary.answered, 1);
  assert.equal(summary.byUser.get("maria")?.offered, 1);
  assert.equal(summary.byUser.get("pedro")?.offered, 1);
  assert.equal(summary.byUser.get("pedro")?.answered, 1);
  assert.equal(summary.byUser.get("ana")?.offered, 1);
});

test("resolveDistributionAgentStatus requires SIP registration, not only CRM online", () => {
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "ONLINE",
      crmPresent: true,
      sipRegistered: false,
      sipBusy: false,
      openOffer: null,
    }),
    "sip_disconnected",
  );
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "ONLINE",
      crmPresent: true,
      sipRegistered: true,
      sipBusy: false,
      openOffer: "OFFERED",
    }),
    "ringing",
  );
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "AWAY",
      crmPresent: true,
      sipRegistered: true,
      sipBusy: false,
      openOffer: null,
    }),
    "paused",
  );
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "ONLINE",
      crmPresent: false,
      sipRegistered: true,
      sipBusy: false,
      openOffer: null,
    }),
    "offline",
  );
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "ONLINE",
      crmPresent: false,
      sipRegistered: false,
      sipBusy: false,
      openOffer: "ANSWERED",
    }),
    "offline",
  );
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "ONLINE",
      crmPresent: true,
      sipRegistered: true,
      sipBusy: true,
      openOffer: "ANSWERED",
    }),
    "in_call",
  );
  assert.equal(
    resolveDistributionAgentStatus({
      availability: "ONLINE",
      crmPresent: true,
      sipRegistered: true,
      sipBusy: false,
      openOffer: "ANSWERED",
    }),
    "available",
  );
});

test("distributionCallerKey ignores the local extension", () => {
  assert.equal(distributionCallerKey("+5511988776655", "110937011"), "5511988776655");
  assert.equal(distributionCallerKey("110937011", "110937011"), "anonymous");
  assert.equal(distributionCallerKey("123", "110937011"), "anonymous");
});
