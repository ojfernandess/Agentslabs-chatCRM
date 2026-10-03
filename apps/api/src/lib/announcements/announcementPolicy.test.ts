import test from "node:test";
import assert from "node:assert/strict";
import {
  announcementMatchesAudience,
  isAnnouncementVisibleToOrganization,
  isSafeAnnouncementLink,
  sanitizeAnnouncementContent,
  slugifyTitle,
} from "./announcementPolicy.js";

const now = new Date("2026-10-03T12:00:00.000Z");

test("slugifyTitle removes accents and keeps a stable slug", () => {
  assert.equal(slugifyTitle("Respostas específicas no WhatsApp"), "respostas-especificas-no-whatsapp");
  assert.equal(slugifyTitle("   "), "aviso");
});

test("sanitizeAnnouncementContent strips scripts, tags and dangerous urls", () => {
  const clean = sanitizeAnnouncementContent(
    '<p>Olá <strong>time</strong></p><script>alert(1)</script><img src=x onerror=alert(1)> javascript:alert(1)',
  );
  assert.equal(clean.includes("<"), false);
  assert.equal(clean.includes("script"), false);
  assert.equal(clean.includes("javascript"), false);
  assert.equal(clean.includes("Olá"), true);
  assert.equal(clean.includes("time"), true);
});

test("isSafeAnnouncementLink allows internal paths and http(s) only", () => {
  assert.equal(isSafeAnnouncementLink("/settings/whatsapp"), true);
  assert.equal(isSafeAnnouncementLink("https://opennexo.com/novidade"), true);
  assert.equal(isSafeAnnouncementLink("javascript:alert(1)"), false);
  assert.equal(isSafeAnnouncementLink("//evil.example"), false);
  assert.equal(isSafeAnnouncementLink("data:text/html,hi"), false);
});

test("audience is per organization and plan, never implied by another org", () => {
  const targets = [
    { targetType: "ORGANIZATION" as const, targetId: "org-a" },
    { targetType: "PLAN" as const, targetId: "plan-pro" },
  ];
  assert.equal(announcementMatchesAudience(targets, "org-a", null), true);
  assert.equal(announcementMatchesAudience(targets, "org-b", "plan-pro"), true);
  assert.equal(announcementMatchesAudience(targets, "org-b", "plan-starter"), false);
  assert.equal(
    announcementMatchesAudience([{ targetType: "ALL", targetId: "" }], "org-b", null),
    true,
  );
});

test("visibility requires published, in window, and matching audience", () => {
  const base = {
    status: "PUBLISHED",
    deletedAt: null,
    publishedAt: new Date("2026-10-01T12:00:00.000Z"),
    expiresAt: null as Date | null,
    now,
    targets: [{ targetType: "ALL" as const, targetId: "" }],
    organizationId: "org-a",
    planId: null as string | null,
  };
  assert.equal(isAnnouncementVisibleToOrganization(base), true);
  assert.equal(isAnnouncementVisibleToOrganization({ ...base, status: "DRAFT" }), false);
  assert.equal(isAnnouncementVisibleToOrganization({ ...base, status: "SCHEDULED" }), false);
  assert.equal(
    isAnnouncementVisibleToOrganization({
      ...base,
      expiresAt: new Date("2026-10-02T12:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    isAnnouncementVisibleToOrganization({
      ...base,
      targets: [{ targetType: "ORGANIZATION", targetId: "org-b" }],
    }),
    false,
  );
});
