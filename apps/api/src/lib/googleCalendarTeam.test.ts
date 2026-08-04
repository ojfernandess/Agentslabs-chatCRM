import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calendarEntryKey,
  indexConnectedCalendarNames,
  rebuildConnectedCalendars,
  resolveCalendarBookingTarget,
  type GoogleCalendarTeamMember,
} from "./googleCalendarTeam.js";

describe("googleCalendarTeam", () => {
  it("aggregates admin and team calendars with clean agent names", () => {
    const teamMembers: GoogleCalendarTeamMember[] = [
      {
        memberId: "m1",
        email: "maria@gmail.com",
        displayName: "Maria",
        refresh_token: "rt-maria",
        calendar_id: "cal-maria",
        calendars: [{ id: "cal-maria", name: "Agenda Maria" }],
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const connected = rebuildConnectedCalendars({
      adminEmail: "admin@gmail.com",
      adminDisplayName: "Receção",
      adminCalendars: [{ id: "primary", name: "Principal" }],
      teamMembers,
    });
    assert.equal(connected.length, 2);
    assert.equal(connected[0]?.name, "Receção");
    assert.equal(connected[1]?.name, "Maria");
    assert.doesNotMatch(connected[0]?.name ?? "", /@/);
  });

  it("preserves custom calendar names across rebuild", () => {
    const preserveNames = indexConnectedCalendarNames([
      { id: "primary", name: "Agenda VIP", memberId: "admin", email: "admin@gmail.com" },
    ]);
    const connected = rebuildConnectedCalendars({
      adminEmail: "admin@gmail.com",
      adminDisplayName: "Admin",
      adminCalendars: [{ id: "primary", name: "Principal" }],
      teamMembers: [],
      preserveNames,
    });
    assert.equal(connected[0]?.name, "Agenda VIP");
    assert.equal(calendarEntryKey("admin", "primary"), "admin:primary");
  });

  it("uses team member refresh token when calendar_name matches display name", () => {
    const teamMembers: GoogleCalendarTeamMember[] = [
      {
        memberId: "m1",
        email: "maria@gmail.com",
        displayName: "Maria",
        refresh_token: "rt-maria",
        calendar_id: "cal-maria",
        calendars: [{ id: "cal-maria", name: "Agenda Maria" }],
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const connectedCalendars = rebuildConnectedCalendars({
      adminEmail: "admin@gmail.com",
      adminDisplayName: "Receção",
      adminCalendars: [{ id: "primary", name: "Principal" }],
      teamMembers,
    });
    const target = resolveCalendarBookingTarget({
      calendarName: "Maria",
      defaultCalendarId: "primary",
      connectedCalendars,
      adminRefreshToken: "rt-admin",
      clientId: "cid",
      clientSecret: "sec",
      teamMembers,
    });
    assert.ok(target);
    assert.equal(target?.refreshToken, "rt-maria");
    assert.equal(target?.calendarId, "cal-maria");
  });
});
