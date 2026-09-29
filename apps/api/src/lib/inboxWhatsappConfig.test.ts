import assert from "node:assert/strict";
import { test } from "node:test";
import { InboxChannelType } from "@prisma/client";
import {
  inboxWhatsappPhoneNumberIdForColumn,
  withInboxWhatsappPhoneNumberIdColumn,
  parseInboxWhatsappFromChannelConfig,
  shouldFallbackWhatsappCredentialsToSettings,
  allowWhatsappSettingsPhoneInboxFallback,
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

test("shouldFallbackWhatsappCredentialsToSettings blocks non-default WhatsApp inboxes", () => {
  const parsed = parseInboxWhatsappFromChannelConfig({});
  assert.equal(
    shouldFallbackWhatsappCredentialsToSettings(
      { channelConfig: {}, channelType: InboxChannelType.WHATSAPP, isDefault: false },
      parsed,
    ),
    false,
  );
});

test("shouldFallbackWhatsappCredentialsToSettings allows default legacy inbox", () => {
  const parsed = parseInboxWhatsappFromChannelConfig({});
  assert.equal(
    shouldFallbackWhatsappCredentialsToSettings(
      { channelConfig: {}, channelType: InboxChannelType.WHATSAPP, isDefault: true },
      parsed,
    ),
    true,
  );
});

test("shouldFallbackWhatsappCredentialsToSettings blocks when provider set on inbox", () => {
  const parsed = parseInboxWhatsappFromChannelConfig({ whatsappProvider: "meta" });
  assert.equal(
    shouldFallbackWhatsappCredentialsToSettings(
      { channelConfig: {}, channelType: InboxChannelType.WHATSAPP, isDefault: true },
      parsed,
    ),
    false,
  );
});

test("allowWhatsappSettingsPhoneInboxFallback only for single WhatsApp inbox orgs", () => {
  assert.equal(allowWhatsappSettingsPhoneInboxFallback(1), true);
  assert.equal(allowWhatsappSettingsPhoneInboxFallback(2), false);
  assert.equal(allowWhatsappSettingsPhoneInboxFallback(0), false);
});

test("shouldFallbackWhatsappCredentialsToSettings blocks dedicated phone without provider", () => {
  const parsed = parseInboxWhatsappFromChannelConfig({});
  assert.equal(
    shouldFallbackWhatsappCredentialsToSettings(
      {
        channelConfig: {},
        channelType: InboxChannelType.WHATSAPP,
        whatsappPhoneNumberId: "12345",
        isDefault: true,
      },
      parsed,
    ),
    false,
  );
});
