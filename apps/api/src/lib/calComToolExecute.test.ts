import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCalComAgentToolDescription,
  buildCalComCreateBookingBody,
  buildCalComSlotsQuery,
  contactFromRuntimeContext,
  fillCalComAttendee,
  hasCalComEventIdentity,
  normalizeCalComStartToUtc,
  parseCalComAction,
  readCalComToolConfig,
  resolveCalComEventIdentity,
} from "./calComToolExecute.js";

const cfg = readCalComToolConfig({
  apiKey: "cal_live_test",
  eventTypeId: 42,
  username: "rececao",
  timeZone: "America/Sao_Paulo",
  language: "pt-BR",
});

describe("calComToolExecute helpers", () => {
  it("reads defaults and numeric eventTypeId from string", () => {
    const parsed = readCalComToolConfig({
      eventTypeId: "100",
      eventTypeSlug: "consultoria",
      baseUrl: "https://api.cal.com/v2/",
    });
    assert.equal(parsed.eventTypeId, 100);
    assert.equal(parsed.eventTypeSlug, "consultoria");
    assert.equal(parsed.baseUrl, "https://api.cal.com/v2");
    assert.equal(parsed.timeZone, "America/Sao_Paulo");
    assert.equal(parsed.language, "pt-BR");
  });

  it("parses supported actions and rejects unknown", () => {
    assert.equal(parseCalComAction("create-booking"), "create_booking");
    assert.equal(parseCalComAction("GET_SLOTS"), "get_slots");
    assert.equal(parseCalComAction("delete"), null);
  });

  it("prefers LLM event identity over tool config", () => {
    const identity = resolveCalComEventIdentity(cfg, {
      eventTypeSlug: "intro",
      username: "bob",
    });
    assert.equal(identity.eventTypeId, 42);
    assert.equal(identity.eventTypeSlug, "intro");
    assert.equal(identity.username, "bob");
    assert.equal(hasCalComEventIdentity({ eventTypeId: null, eventTypeSlug: "", username: "", teamSlug: "", organizationSlug: "" }), false);
    assert.equal(
      hasCalComEventIdentity({
        eventTypeId: null,
        eventTypeSlug: "intro",
        username: "bob",
        teamSlug: "",
        organizationSlug: "",
      }),
      true,
    );
  });

  it("normalizes offset timestamps to UTC for create booking", () => {
    const utc = normalizeCalComStartToUtc("2050-09-05T11:00:00.000+02:00");
    assert.equal(utc, "2050-09-05T09:00:00.000Z");
    assert.equal(normalizeCalComStartToUtc("not-a-date"), null);
  });

  it("builds slots query with start/end and identity", () => {
    const { query, missing } = buildCalComSlotsQuery(
      resolveCalComEventIdentity(cfg, {}),
      { start: "2050-09-05", end: "2050-09-06" },
      cfg,
    );
    assert.deepEqual(missing, []);
    assert.equal(query.get("eventTypeId"), "42");
    assert.equal(query.get("start"), "2050-09-05");
    assert.equal(query.get("timeZone"), "America/Sao_Paulo");
    assert.equal(query.get("format"), "range");
  });

  it("requires start/end for slots", () => {
    const { missing } = buildCalComSlotsQuery(resolveCalComEventIdentity(cfg, {}), {}, cfg);
    assert.ok(missing.includes("start"));
    assert.ok(missing.includes("end"));
  });

  it("fills attendee from contact when LLM omits fields", () => {
    const attendee = fillCalComAttendee({}, cfg, {
      name: "Maria Silva",
      email: "maria@example.com",
      phone: "+5511999990000",
    });
    assert.equal(attendee.name, "Maria Silva");
    assert.equal(attendee.email, "maria@example.com");
    assert.equal(attendee.phoneNumber, "+5511999990000");
    assert.deepEqual(attendee.autoFilledFields, ["name", "email", "phoneNumber"]);
  });

  it("builds create booking body in UTC with eventTypeId from config", () => {
    const attendee = fillCalComAttendee(
      { name: "João", email: "joao@hotel.com", start: "2050-09-05T11:00:00.000+02:00" },
      cfg,
    );
    const { body, missing } = buildCalComCreateBookingBody(
      resolveCalComEventIdentity(cfg, {}),
      { start: "2050-09-05T11:00:00.000+02:00" },
      attendee,
    );
    assert.deepEqual(missing, []);
    assert.equal(body.start, "2050-09-05T09:00:00.000Z");
    assert.equal(body.eventTypeId, 42);
    const att = body.attendee as Record<string, unknown>;
    assert.equal(att.name, "João");
    assert.equal(att.email, "joao@hotel.com");
    assert.equal(att.timeZone, "America/Sao_Paulo");
    assert.equal(att.language, "pt-BR");
  });

  it("reads contact from HTTP runtime context", () => {
    const contact = contactFromRuntimeContext({
      contact: { id: "c1", name: "Ana", phone: "+5511", email: "ana@x.com" },
    });
    assert.equal(contact?.email, "ana@x.com");
  });

  it("describes default event type for the agent", () => {
    const desc = buildCalComAgentToolDescription({ eventTypeId: 9, timeZone: "America/Sao_Paulo" });
    assert.match(desc, /Event type padrão: id 9/);
    assert.match(desc, /get_slots/);
    assert.match(desc, /create_booking/);
  });
});
