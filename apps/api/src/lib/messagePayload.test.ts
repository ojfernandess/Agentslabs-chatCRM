import assert from "node:assert/strict";
import test from "node:test";
import { sendMessageSchema } from "./messagePayload.js";

test("TEXT requires non-empty body", () => {
  const r = sendMessageSchema.safeParse({
    contactId: "550e8400-e29b-41d4-a716-446655440000",
    type: "TEXT",
  });
  assert.equal(r.success, false);
});

test("AUDIO requires mediaUrl", () => {
  const r = sendMessageSchema.safeParse({
    contactId: "550e8400-e29b-41d4-a716-446655440000",
    type: "AUDIO",
  });
  assert.equal(r.success, false);
});

test("AUDIO accepts public https mediaUrl", () => {
  const r = sendMessageSchema.safeParse({
    contactId: "550e8400-e29b-41d4-a716-446655440000",
    type: "AUDIO",
    mediaUrl: "https://example.com/api/v1/messages/media/abcd1234.webm",
  });
  assert.equal(r.success, true);
});
