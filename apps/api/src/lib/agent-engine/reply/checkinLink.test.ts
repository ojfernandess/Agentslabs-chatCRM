import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCheckinLink,
  deduplicateCheckinLinksInReply,
  extractCheckinBaseUrlFromPlaybook,
  isLikelyCheckinUrl,
  resolveCheckinLink,
} from "./checkinLink.js";

test("buildCheckinLink with locator uses direct URL", () => {
  assert.equal(buildCheckinLink({ locator: "HHTIDAS" }), "https://checkin.audaar.com.br/HHTIDAS");
});

test("buildCheckinLink without locator returns base URL", () => {
  assert.equal(buildCheckinLink(), "https://checkin.audaar.com.br/");
});

test("resolveCheckinLink reads base from playbook markdown", () => {
  const playbook =
    "Link oficial: https://checkin.audaar.com.br/{LOCALIZADOR}\n" +
    "Sem localizador: https://checkin.audaar.com.br/";
  assert.equal(
    resolveCheckinLink({ locator: "NCMT0VPN", playbookText: playbook }),
    "https://checkin.audaar.com.br/NCMT0VPN",
  );
  assert.equal(resolveCheckinLink({ playbookText: playbook }), "https://checkin.audaar.com.br/");
});

test("resolveCheckinLink prefers configured enrichment over playbook", () => {
  assert.equal(
    resolveCheckinLink({
      locator: "ABC12345",
      configuredLink: "https://custom.example/checkin/{LOCALIZADOR}",
      playbookText: "https://checkin.audaar.com.br/",
    }),
    "https://custom.example/checkin/ABC12345",
  );
});

test("extractCheckinBaseUrlFromPlaybook supports legacy pms URL", () => {
  const base = extractCheckinBaseUrlFromPlaybook(
    "Acesse https://pms.audaar.com.br/checkin/vivapp/access para check-in.",
  );
  assert.equal(base, "https://pms.audaar.com.br/checkin/vivapp/access");
});

test("deduplicateCheckinLinksInReply merges mixed domains and keeps locator URL", () => {
  const dup =
    "Check-in: https://pms.audaar.com.br/checkin/vivapp/access\n\n" +
    "🔗 https://checkin.audaar.com.br/HHTIDAS\n\n" +
    "Link: https://checkin.audaar.com.br/HHTIDAS";
  const out = deduplicateCheckinLinksInReply(dup);
  assert.equal((out.match(/https?:\/\//g) ?? []).length, 1);
  assert.match(out, /checkin\.audaar\.com\.br\/HHTIDAS/i);
});

test("isLikelyCheckinUrl detects new and legacy patterns", () => {
  assert.equal(isLikelyCheckinUrl("https://checkin.audaar.com.br/"), true);
  assert.equal(isLikelyCheckinUrl("https://pms.audaar.com.br/checkin/vivapp/access"), true);
  assert.equal(isLikelyCheckinUrl("https://example.com/help"), false);
});
