import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inboxWhatsappPhoneNumberIdForColumn,
  withInboxWhatsappPhoneNumberIdColumn,
  parseInboxWhatsappFromChannelConfig,
} from "./inboxWhatsappConfig.js";

test("inboxWhatsappPhoneNumberIdForColumn reads channelConfig", () => {
  assert.equal(
    inboxWhatsappPhoneNumberIdForColumn({
      whatsappProvider: "meta",
      whatsappPhoneNumberId: " 123456789 ",
    }),
    "123456789",
  );
  assert.equal(inboxWhatsappPhoneNumberIdForColumn({ whatsappProvider: "meta" }), null);
  assert.equal(inboxWhatsappPhoneNumberIdForColumn(null), null);
});

test("withInboxWhatsappPhoneNumberIdColumn syncs indexed column", () => {
  const data = withInboxWhatsappPhoneNumberIdColumn({
    channelConfig: {
      whatsappProvider: "meta",
      whatsappPhoneNumberId: "pn-42",
    },
  });
  assert.equal(data.whatsappPhoneNumberId, "pn-42");
});

test("withInboxWhatsappPhoneNumberIdColumn clears column when config cleared", () => {
  const data = withInboxWhatsappPhoneNumberIdColumn({
    channelConfig: null,
  });
  assert.equal(data.whatsappPhoneNumberId, null);
});

test("withInboxWhatsappPhoneNumberIdColumn leaves unrelated updates untouched", () => {
  const data = withInboxWhatsappPhoneNumberIdColumn({ name: "Support" });
  assert.equal(data.name, "Support");
  assert.equal(data.whatsappPhoneNumberId, undefined);
});

test("parseInboxWhatsappFromChannelConfig unchanged for indexed helper source", () => {
  const cfg = { whatsappProvider: "360dialog", whatsappPhoneNumberId: "abc" };
  assert.deepEqual(parseInboxWhatsappFromChannelConfig(cfg).whatsappPhoneNumberId, "abc");
  assert.equal(inboxWhatsappPhoneNumberIdForColumn(cfg), "abc");
});
