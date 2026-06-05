import assert from "node:assert/strict";
import test from "node:test";
import { extractMetaWebhookPhoneNumberId, isMetaCloudWebhookPayload } from "./metaWebhookPayload.js";

test("extractMetaWebhookPhoneNumberId reads phone_number_id", () => {
  const payload = {
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "999888777" } } }] }],
  };
  assert.equal(extractMetaWebhookPhoneNumberId(payload), "999888777");
  assert.equal(isMetaCloudWebhookPayload(payload), true);
  assert.equal(isMetaCloudWebhookPayload({}), false);
});
