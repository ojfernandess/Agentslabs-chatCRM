import assert from "node:assert/strict";
import { test } from "node:test";
import {
  factsFromReservationPayload,
  interpolateTemplateBody,
  renderReplyTemplate,
  resolveReservationLookupTemplateId,
} from "./ReplyTemplateRenderer.js";

test("interpolateTemplateBody replaces facts placeholders", () => {
  const out = interpolateTemplateBody("Olá {{facts.name}} em {{facts.city}}", {
    name: "João",
    city: "SP",
  });
  assert.equal(out, "Olá João em SP");
});

test("renderReplyTemplate reservation lookup check-in", () => {
  const facts = factsFromReservationPayload(
    {
      establishmentName: "Hotel Test",
      checkinDate: "2026-08-01",
      checkoutDate: "2026-08-03",
      guestsQuantity: 2,
    },
    "fazer check-in NCMT0VPN",
  );
  const reply = renderReplyTemplate({
    templateId: resolveReservationLookupTemplateId(facts),
    facts,
  });
  assert.match(reply, /Encontramos sua reserva/);
  assert.match(reply, /Hotel Test/);
  assert.match(reply, /01\/08\/2026/);
  assert.match(reply, /realize seu cadastro|1️⃣/i);
});

test("renderReplyTemplate reservation_lookup_completed", () => {
  const reply = renderReplyTemplate({
    templateId: "reservation_lookup_completed",
    facts: {
      lodging: "Hotel Test",
      locator: "ABC123",
      roomLabel: "101",
      checkIn: "01/08/2026",
      checkOut: "03/08/2026",
      checkInTime: "14:00",
      checkOutTime: "12:00",
      roomPassword: "1234",
    },
  });
  assert.match(reply, /check-in foi concluído/i);
});

test("factsFromReservationPayload prefers localizer over uid and userMessage locator", () => {
  const facts = factsFromReservationPayload(
    {
      data: {
        uid: "991827364",
        stay: { localizer: "WIAHY1HC", guestsQuantity: 2 },
      },
    },
    "WIAHY1HC",
  );
  assert.equal(facts.locator, "WIAHY1HC");
  assert.equal(facts.locatorSuffix, " WIAHY1HC");
});

test("check-in done via checkinApi / nested validatedCheckin (Audaar flags)", () => {
  const viaApi = factsFromReservationPayload(
    {
      establishmentName: "Hotel Test",
      checkinDate: "2026-08-01",
      checkoutDate: "2026-08-03",
      guestsQuantity: 2,
      checkinApi: 1,
      room: { roomNumber: "12" },
    },
    "Gostaria de saber se minha reserva está confirmada ABRJQPTF",
  );
  assert.equal(viaApi.checkInDone, true);
  assert.equal(resolveReservationLookupTemplateId(viaApi), "reservation_lookup_done");
  assert.match(
    renderReplyTemplate({ templateId: resolveReservationLookupTemplateId(viaApi), facts: viaApi }),
    /Check-in:\s*já realizado/i,
  );

  const viaNested = factsFromReservationPayload(
    {
      data: {
        establishmentName: "Hotel Test",
        checkinDate: "2026-08-01",
        checkoutDate: "2026-08-03",
        guestsQuantity: 1,
        checkin: { validatedCheckin: 1, reservationId: 279321 },
        room: { roomNumber: "101", categoryName: "Standard" },
        access: { roomPassword: "9988" },
      },
    },
    "reserva confirmada ABC123",
  );
  assert.equal(viaNested.checkInDone, true);
  assert.equal(resolveReservationLookupTemplateId(viaNested), "reservation_lookup_done");

  const viaPlainCheckin = factsFromReservationPayload(
    { checkin: 1, establishmentName: "Hotel X", checkinDate: "2026-08-01", checkoutDate: "2026-08-02", guestsQuantity: 1 },
    "status da reserva XYZ",
  );
  assert.equal(viaPlainCheckin.checkInDone, true);

  const stillPending = factsFromReservationPayload(
    {
      establishmentName: "Hotel Test",
      checkinDate: "2026-08-01",
      checkoutDate: "2026-08-03",
      guestsQuantity: 2,
      checkinApi: 0,
    },
    "reserva confirmada ABC123",
  );
  assert.equal(stillPending.checkInDone, false);
  assert.equal(resolveReservationLookupTemplateId(stillPending), "reservation_lookup_verify");
});
