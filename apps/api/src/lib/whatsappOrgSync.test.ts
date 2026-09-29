import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldClearLegacyWhatsappOrgSettings } from "./whatsappOrgSync.js";

test("shouldClearLegacyWhatsappOrgSettings clears on dedicated non-default inbox in multi-inbox org", () => {
  assert.equal(
    shouldClearLegacyWhatsappOrgSettings({
      whatsappInboxCount: 2,
      savedInboxIsDefault: false,
      savedInboxConfigured: true,
      settingsHasWhatsapp: true,
    }),
    true,
  );
});

test("shouldClearLegacyWhatsappOrgSettings keeps settings for single-inbox org", () => {
  assert.equal(
    shouldClearLegacyWhatsappOrgSettings({
      whatsappInboxCount: 1,
      savedInboxIsDefault: false,
      savedInboxConfigured: true,
      settingsHasWhatsapp: true,
    }),
    false,
  );
});

test("shouldClearLegacyWhatsappOrgSettings keeps settings when saving default inbox", () => {
  assert.equal(
    shouldClearLegacyWhatsappOrgSettings({
      whatsappInboxCount: 2,
      savedInboxIsDefault: true,
      savedInboxConfigured: true,
      settingsHasWhatsapp: true,
    }),
    false,
  );
});

test("shouldClearLegacyWhatsappOrgSettings skips when inbox not fully configured", () => {
  assert.equal(
    shouldClearLegacyWhatsappOrgSettings({
      whatsappInboxCount: 2,
      savedInboxIsDefault: false,
      savedInboxConfigured: false,
      settingsHasWhatsapp: true,
    }),
    false,
  );
});
