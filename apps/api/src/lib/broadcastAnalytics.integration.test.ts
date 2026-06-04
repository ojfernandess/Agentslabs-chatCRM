import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalyticsExportCsv, buildCampaignFilterForAnalytics } from "./broadcastAnalytics.js";
import { parseAnalyticsQuery } from "./broadcastAnalyticsQuery.js";

test("buildCampaignFilterForAnalytics scopes follow-up campaigns", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440000";
  const followup = buildCampaignFilterForAnalytics(
    orgId,
    parseAnalyticsQuery({ campaignKind: "followup" }),
  );
  assert.deepEqual(followup.segmentRules, { path: ["campaignKind"], equals: "followup" });
  assert.equal(followup.organizationId, orgId);

  const all = buildCampaignFilterForAnalytics(orgId, parseAnalyticsQuery({}));
  assert.equal(all.segmentRules, undefined);
});

test("buildAnalyticsExportCsv escapes commas and quotes", () => {
  const csv = buildAnalyticsExportCsv([
    {
      id: "1",
      sentAt: "2026-05-01T12:00:00.000Z",
      createdAt: "2026-05-01T12:00:00.000Z",
      status: "FAILED",
      channel: "WHATSAPP",
      campaignId: "c1",
      campaignName: "Test, campaign",
      campaignKind: "followup",
      contactId: "ct1",
      contactName: 'João "VIP"',
      phone: "+5511999990001",
      email: null,
      error: "Error, with comma",
      errorCategory: "gateway",
      openedAt: null,
      respondedAt: null,
    },
  ]);
  assert.ok(csv.startsWith("sentAt,campaignName"));
  assert.ok(csv.includes('"Test, campaign"'));
  assert.ok(csv.includes('"Error, with comma"'));
});
