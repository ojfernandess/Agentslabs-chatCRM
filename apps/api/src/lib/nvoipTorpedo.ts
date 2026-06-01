import { randomBytes } from "node:crypto";
import type { BroadcastCampaign, Contact, NvoipAccount, Prisma } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { findNvoipAccountInOrg, normalizeDialPhone } from "./nvoipCallContext.js";
import { nvoipSendVoiceTorpedo } from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { appendTimelineEvent } from "./timeline.js";
import type { BroadcastSegmentRules, NvoipTorpedoDtmfRule } from "./broadcastTypes.js";

export function nvoipVoiceSafeText(text: string, maxLen = 900): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function parseDtmfRules(segmentRules: BroadcastSegmentRules | null): NvoipTorpedoDtmfRule[] {
  const raw = segmentRules?.nvoipTorpedo?.dtmfRules;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is NvoipTorpedoDtmfRule =>
      r != null &&
      typeof r === "object" &&
      typeof (r as NvoipTorpedoDtmfRule).digit === "string" &&
      (r as NvoipTorpedoDtmfRule).digit.trim().length > 0,
  );
}

function buildDtmfPayload(
  organizationId: string,
  dispatchId: string,
  webhookToken: string,
  rules: NvoipTorpedoDtmfRule[],
) {
  const baseUrl = `${config.publicUrl}/webhooks/nvoip/${organizationId}/dtmf/${dispatchId}`;
  const callbackUrl = `${baseUrl}?token=${encodeURIComponent(webhookToken)}`;
  return rules.map((rule) => ({
    digit: rule.digit.replace(/\D/g, "").slice(0, 1),
    url: callbackUrl,
    ...(rule.label ? { label: rule.label.slice(0, 64) } : {}),
  }));
}

export async function deliverNvoipVoiceTorpedo(input: {
  campaign: BroadcastCampaign;
  contact: Contact;
  body: string;
  actorUserId: string;
}): Promise<void> {
  const enabled = await isOrganizationFeatureEnabled(input.campaign.organizationId, "nvoip_voice");
  if (!enabled) throw new Error("nvoip_voice_disabled");

  const account = await findNvoipAccountInOrg(input.campaign.organizationId);
  if (!account || account.status !== "CONNECTED") {
    throw new Error("nvoip_not_configured");
  }

  const dialPhone = normalizeDialPhone(input.contact.phone);
  if (!dialPhone) throw new Error("contact_phone_invalid");

  const segmentRules = input.campaign.segmentRules as BroadcastSegmentRules | null;
  const caller =
    segmentRules?.nvoipTorpedo?.caller?.trim() || account.defaultCaller.trim();
  if (!caller) throw new Error("nvoip_no_caller");

  const messageText = nvoipVoiceSafeText(input.body);
  if (!messageText) throw new Error("nvoip_torpedo_empty_message");

  const dtmfRules = parseDtmfRules(segmentRules);
  const webhookToken = randomBytes(24).toString("hex");

  const dispatch = await prisma.nvoipTorpedoDispatch.create({
    data: {
      organizationId: input.campaign.organizationId,
      nvoipAccountId: account.id,
      campaignId: input.campaign.id,
      contactId: input.contact.id,
      calledPhone: dialPhone.replace(/\D/g, "").slice(0, 32),
      caller: caller.replace(/\D/g, "").slice(0, 32) || caller,
      messageText,
      webhookToken,
      dtmfRules: dtmfRules.length ? (dtmfRules as unknown as Prisma.InputJsonValue) : undefined,
      status: "PENDING",
    },
  });

  const audios = [{ text: messageText }];
  const dtmfs = dtmfRules.length
    ? buildDtmfPayload(input.campaign.organizationId, dispatch.id, webhookToken, dtmfRules)
    : undefined;

  let apiResult: { schedkey?: string; raw: Record<string, unknown> };
  try {
    apiResult = await nvoipSendVoiceTorpedo(account, {
      caller,
      called: dialPhone,
      audios,
      dtmfs,
    });
  } catch (err) {
    await prisma.nvoipTorpedoDispatch.update({
      where: { id: dispatch.id },
      data: { status: "FAILED" },
    });
    throw err;
  }

  const externalCallId =
    typeof apiResult.raw.callId === "string"
      ? apiResult.raw.callId
      : typeof apiResult.raw.id === "string"
        ? apiResult.raw.id
        : null;

  await prisma.nvoipTorpedoDispatch.update({
    where: { id: dispatch.id },
    data: {
      status: "SENT",
      externalCallId,
      schedkey: apiResult.schedkey ?? null,
      rawPayload: apiResult.raw as Prisma.InputJsonValue,
    },
  });

  if (apiResult.schedkey) {
    await prisma.nvoipScheduledTorpedo.upsert({
      where: { schedkey: apiResult.schedkey },
      create: {
        organizationId: input.campaign.organizationId,
        nvoipAccountId: account.id,
        campaignId: input.campaign.id,
        schedkey: apiResult.schedkey,
        status: "SCHEDULED",
        recipientCount: 1,
        scheduledAt: input.campaign.scheduledAt,
        payload: apiResult.raw as object,
      },
      update: {
        status: "SCHEDULED",
        payload: apiResult.raw as object,
      },
    });
  }

  await appendTimelineEvent({
    organizationId: input.campaign.organizationId,
    subjectType: "CONTACT",
    subjectId: input.contact.id,
    eventType: "nvoip_torpedo",
    channel: "NVOIP",
    actorUserId: input.actorUserId,
    sourceId: dispatch.id,
    payload: {
      title: `Torpedo de voz — ${input.campaign.name}`,
      campaignId: input.campaign.id,
      phone: dialPhone,
    },
  });

  await writeNvoipIntegrationLog({
    organizationId: input.campaign.organizationId,
    nvoipAccountId: account.id,
    level: "info",
    eventType: "torpedo_sent",
    message: `Torpedo sent to ${dialPhone}`,
    payload: { dispatchId: dispatch.id, campaignId: input.campaign.id },
  });
}

export async function sendNvoipTorpedoTest(input: {
  organizationId: string;
  account: NvoipAccount;
  phone: string;
  message: string;
  caller?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const dialPhone = normalizeDialPhone(input.phone);
  if (!dialPhone) return { ok: false, message: "invalid_phone" };
  const caller = (input.caller ?? input.account.defaultCaller).trim();
  if (!caller) return { ok: false, message: "nvoip_no_caller" };
  const text = nvoipVoiceSafeText(input.message);
  if (!text) return { ok: false, message: "empty_message" };
  try {
    await nvoipSendVoiceTorpedo(input.account, {
      caller,
      called: dialPhone,
      audios: [{ text }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "torpedo_failed" };
  }
}
