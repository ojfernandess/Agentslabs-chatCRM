import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicSystemDocumentationPayload,
  DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG,
  parsePublicSystemDocumentationConfig,
} from "./publicSystemDocumentationSettings.js";

test("parsePublicSystemDocumentationConfig accepts legacy boolean true", () => {
  const config = parsePublicSystemDocumentationConfig(true);
  assert.equal(config.enabled, true);
  assert.equal(config.sections.conventions, true);
  assert.equal(config.groups.tenant_api, true);
});

test("parsePublicSystemDocumentationConfig merges structured config", () => {
  const config = parsePublicSystemDocumentationConfig({
    enabled: true,
    sections: { ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG.sections, changelog: false },
    groups: { tenant_api: true, super_admin: false },
  });
  assert.equal(config.enabled, true);
  assert.equal(config.sections.changelog, false);
  assert.equal(config.groups.tenant_api, true);
  assert.equal(config.groups.super_admin, false);
});

test("buildPublicSystemDocumentationPayload filters hidden sections and groups", () => {
  const payload = buildPublicSystemDocumentationPayload({
    enabled: true,
    sections: {
      conventions: true,
      auth: false,
      schemas: false,
      changelog: false,
      quickGuide: false,
      emailGuide: false,
      n8nGuide: false,
      postmanDownload: false,
      botAutomationNav: false,
    },
    groups: {
      ...DEFAULT_PUBLIC_SYSTEM_DOCUMENTATION_CONFIG.groups,
      super_admin: false,
    },
  });
  assert.ok(payload.conventions);
  assert.equal(payload.schemas, undefined);
  assert.equal(payload.changelog, undefined);
  assert.equal(payload.guides, undefined);
  assert.ok(payload.groups.every((g) => g.id !== "super_admin"));
  assert.equal(payload.visibility.sections.botAutomationNav, false);
});
