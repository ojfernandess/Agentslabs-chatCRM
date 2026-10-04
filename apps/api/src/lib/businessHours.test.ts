import assert from "node:assert/strict";
import { test } from "node:test";
import {
  businessMinutesBetween,
  parseTeamBusinessHours,
  resolveConversationBusinessSchedule,
  sharedBusinessSchedule,
} from "./businessHours.js";

const weekday = {
  timezone: "America/Sao_Paulo",
  start: "09:00",
  end: "18:00",
  workDays: [1, 2, 3, 4, 5],
};

test("parseTeamBusinessHours accepts clock values with seconds", () => {
  const parsed = parseTeamBusinessHours({ ...weekday, start: "09:00:00", end: "18:00:00" });
  assert.ok(parsed);
  assert.equal(parsed.openMin, 9 * 60);
  assert.equal(parsed.closeMin, 18 * 60);
});

test("businessMinutesBetween counts only the open window", () => {
  const schedule = parseTeamBusinessHours(weekday);
  assert.ok(schedule);
  const start = new Date("2026-10-05T15:00:00.000Z");
  const end = new Date("2026-10-05T15:30:00.000Z");
  assert.equal(businessMinutesBetween(start, end, schedule), 30);
});

test("resolveConversationBusinessSchedule uses the org calendar when the conversation has no team", () => {
  const schedule = parseTeamBusinessHours(weekday);
  assert.ok(schedule);
  const scheduleByTeamId = new Map([["team-a", schedule]]);
  const resolved = resolveConversationBusinessSchedule({
    teamId: null,
    assigneeId: null,
    scheduleByTeamId,
    orgFallback: sharedBusinessSchedule(scheduleByTeamId.values()),
  });
  assert.equal(resolved, schedule);
});

test("resolveConversationBusinessSchedule keeps the conversation team calendar", () => {
  const morning = parseTeamBusinessHours(weekday);
  const late = parseTeamBusinessHours({ ...weekday, start: "12:00", end: "20:00" });
  assert.ok(morning);
  assert.ok(late);
  const scheduleByTeamId = new Map([
    ["team-a", morning],
    ["team-b", late],
  ]);
  const resolved = resolveConversationBusinessSchedule({
    teamId: "team-b",
    scheduleByTeamId,
    orgFallback: sharedBusinessSchedule(scheduleByTeamId.values()),
  });
  assert.equal(resolved, late);
  assert.equal(sharedBusinessSchedule(scheduleByTeamId.values()), null);
});
