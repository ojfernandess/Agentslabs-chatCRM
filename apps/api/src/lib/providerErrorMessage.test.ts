import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMetaWebhookStatusError,
  sanitizeProviderErrorMessage,
} from "./providerErrorMessage.js";

test("sanitizeProviderErrorMessage truncates and redacts bearer tokens", () => {
  const long = "x".repeat(600);
  assert.equal(sanitizeProviderErrorMessage(long)?.length, 500);
  assert.match(
    sanitizeProviderErrorMessage("Meta API error Bearer abc.def.ghi") ?? "",
    /Bearer \[REDACTED\]/,
  );
});

test("formatMetaWebhookStatusError joins code title and details", () => {
  const text = formatMetaWebhookStatusError([
    {
      code: 131026,
      title: "Message undeliverable",
      error_data: { details: "Recipient is not a valid WhatsApp user" },
    },
  ]);
  assert.ok(text?.includes("131026"));
  assert.ok(text?.includes("Message undeliverable"));
  assert.ok(text?.includes("Recipient is not a valid WhatsApp user"));
});
