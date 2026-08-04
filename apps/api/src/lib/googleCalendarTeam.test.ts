import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rebuildConnectedCalendars,
  resolveCalendarBookingTarget,
  type GoogleCalendarTeamMember,
} from "./googleCalendarTeam.js";

describe("googleCalendarTeam", () => {
  it("aggregates admin and team calendars with identifiable names", () => {
    const teamMembers: GoogleCalendarTeamMember[] = [
      {
        memberId: "m1",
        email: "maria@gmail.com",
        refresh_token: "rt-maria",
        calendar_id: "cal-maria",
        calendars: [{ id: "cal-maria", name: "Agenda Maria" }],
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const connected = rebuildConnectedCalendars({
      adminEmail: "admin@gmail.com",
      adminCalendars: [{ id: "primary", name: "Principal" }],
      teamMembers,
    });
    assert.equal(connected.length, 2);
    assert.match(connected[1]?.name ?? "", /maria@gmail.com/i);
  });

  it("uses team member refresh token when calendar_name matches member email", () => {
    const teamMembers: GoogleCalendarTeamMember[] = [
      {
        memberId: "m1",
        email: "maria@gmail.com",
        refresh_token: "rt-maria",
        calendar_id: "cal-maria",
        calendars: [{ id: "cal-maria", name: "Agenda Maria" }],
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const connectedCalendars = rebuildConnectedCalendars({
      adminEmail: "admin@gmail.com",
      adminCalendars: [{ id: "primary", name: "Principal (admin@gmail.com)" }],
      teamMembers,
    });
    const target = resolveCalendarBookingTarget({
      calendarName: "maria@gmail.com",
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
