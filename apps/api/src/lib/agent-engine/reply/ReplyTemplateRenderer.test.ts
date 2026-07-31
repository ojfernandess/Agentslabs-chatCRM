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
