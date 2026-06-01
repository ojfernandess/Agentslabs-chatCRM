import type { FastifyBaseLogger } from "fastify";
import { Resend } from "resend";
import type { BroadcastCampaign, Contact } from "@prisma/client";
import { prisma } from "../db.js";
import {
  deliverOutboundWhatsAppMessage,
  type PostSendConversationPolicy,
} from "./outboundMessage.js";
import type { SendMessageInput } from "./messagePayload.js";
import { getWhatsappProviderKindForInbox } from "../providers/factory.js";
import { getResendEmailConfigFromDb } from "./resendEmailSettings.js";
import type { ChannelNativeConfig } from "./channelNativeTypes.js";
import { parseSegmentRules, substituteContactVars } from "./broadcastTypes.js";
import type { BroadcastAbVariantPayload, FollowUpAfterSendMode } from "./broadcastTypes.js";
import { seedFollowUpCampaignAutomationContext } from "./automationConversationContextLib.js";
import { getAgentBotDispatchContextForInbox } from "./agentBotTriage.js";
import { deliverNvoipVoiceTorpedo } from "./nvoipTorpedo.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";

function postSendPolicyForCampaign(campaign: BroadcastCampaign): PostSendConversationPolicy {
  const rules = parseSegmentRules(campaign.segmentRules);
  if (rules?.campaignKind !== "followup") return "default";
  const mode: FollowUpAfterSendMode | undefined = rules.followUpAfterSend;
  if (!mode) return "default";
  return mode === "bot" ? "bot_queue" : "human_handoff";
}

function newConversationForCampaign(
  campaign: BroadcastCampaign,
  actorUserId: string,
): { status: "OPEN" | "PENDING"; assignedToId?: string | null } {
  const policy = postSendPolicyForCampaign(campaign);
  if (policy === "bot_queue" || policy === "human_handoff") {
    return { status: "PENDING", assignedToId: null };
  }
  return { status: "OPEN", assignedToId: actorUserId };
}

export interface CampaignSendPayload {
  body?: string | null;
  templateId?: string | null;
  messageType: "TEXT" | "TEMPLATE";
  subject?: string | null;
}

function mapChannelToInboxType(channel: string): string | null {
  const m: Record<string, string> = {
    WHATSAPP: "WHATSAPP",
    EMAIL: "EMAIL",
    SMS: "SMS",
    TELEGRAM: "TELEGRAM",
    INSTAGRAM: "INSTAGRAM",
    MESSENGER: "FACEBOOK",
    PUSH: "API",
    WEBHOOK: "API",
    VOICE: "VOICE",
  };
  return m[channel] ?? null;
}

async function resolveInboxId(organizationId: string, channel: string, inboxId?: string | null): Promise<string> {
  const expectedType = mapChannelToInboxType(channel);
  if (inboxId) {
    const row = await prisma.inbox.findFirst({ where: { id: inboxId, organizationId } });
    if (row && (!expectedType || row.channelType === expectedType)) return row.id;
  }
  const inboxType = mapChannelToInboxType(channel);
  if (inboxType) {
    const match = await prisma.inbox.findFirst({
      where: { organizationId, channelType: inboxType as never },
      orderBy: { createdAt: "asc" },
    });
    if (match) return match.id;
  }
  const def = await prisma.inbox.findFirst({
    where: { organizationId, isDefault: true },
  });
  if (def) return def.id;
  const any = await prisma.inbox.findFirst({ where: { organizationId } });
  if (!any) throw new Error("No inbox configured for this organization");
  return any.id;
}

async function sendViaTwilioSms(
  cfg: ChannelNativeConfig,
  toPhone: string,
  body: string,
): Promise<void> {
  const sid = cfg.twilioAccountSid?.trim();
  const token = cfg.twilioAuthToken?.trim();
  const from = cfg.twilioFromNumber?.trim();
  if (!sid || !token || !from) throw new Error("Twilio SMS not configured on inbox");
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: toPhone, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Twilio SMS failed: ${res.status} ${t.slice(0, 200)}`);
  }
}

async function sendViaResendEmail(to: string, subject: string, html: string): Promise<void> {
  const cfg = await getResendEmailConfigFromDb();
  if (!cfg) throw new Error("Email (Resend) is not configured on the platform");
  const resend = new Resend(cfg.apiKey);
  const { error } = await resend.emails.send({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    to: [to],
    subject,
    html: html.replace(/\n/g, "<br>"),
  });
  if (error) throw new Error(typeof error.message === "string" ? error.message : "resend_error");
}

async function sendViaWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

export async function deliverBroadcastToContact(options: {
  campaign: BroadcastCampaign;
  contact: Contact;
  payload: CampaignSendPayload;
  actorUserId: string;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { campaign, contact, payload, actorUserId, log } = options;
  const bodyRaw = payload.body ?? campaign.body ?? "";
  const body = substituteContactVars(bodyRaw, contact);
  const channel = campaign.channel;

  if (channel === "EMAIL") {
    if (!contact.email?.trim()) throw new Error("Contact has no email");
    await sendViaResendEmail(
      contact.email.trim(),
      payload.subject ?? campaign.subject ?? campaign.name,
      body,
    );
    return;
  }

  if (channel === "WEBHOOK" || channel === "PUSH") {
    const toolId = campaign.integrationToolId;
    if (toolId) {
      const tool = await prisma.automationCustomTool.findFirst({
        where: { id: toolId, organizationId: campaign.organizationId, isActive: true },
      });
      if (!tool) throw new Error("Integration tool not found");
      const cfg = tool.config as Record<string, unknown>;
      const url =
        (typeof cfg.webhookUrl === "string" && cfg.webhookUrl.trim()) ||
        (typeof cfg.baseUrl === "string" && cfg.baseUrl.trim()) ||
        "";
      if (!url) throw new Error("Integration tool has no webhook URL");
      await sendViaWebhook(url, {
        event: "campaign_message",
        toolId: tool.id,
        campaignId: campaign.id,
        contactId: contact.id,
        phone: contact.phone,
        name: contact.name,
        body,
      });
      return;
    }
    const inbox = await prisma.inbox.findFirst({
      where: { id: campaign.inboxId ?? undefined, organizationId: campaign.organizationId },
    });
    const cfg = (inbox?.channelConfig ?? {}) as ChannelNativeConfig;
    const url = cfg.outboundWebhookUrl?.trim();
    if (!url) throw new Error("No webhook URL configured");
    await sendViaWebhook(url, {
      event: "campaign_message",
      campaignId: campaign.id,
      contactId: contact.id,
      channel,
      body,
    });
    return;
  }

  if (channel === "SMS") {
    const inboxId = await resolveInboxId(campaign.organizationId, channel, campaign.inboxId);
    const inbox = await prisma.inbox.findUnique({ where: { id: inboxId } });
    const cfg = (inbox?.channelConfig ?? {}) as ChannelNativeConfig;
    await sendViaTwilioSms(cfg, contact.phone, body);
    return;
  }

  if (channel === "VOICE") {
    const voiceEnabled = await isOrganizationFeatureEnabled(campaign.organizationId, "nvoip_voice");
    if (!voiceEnabled) throw new Error("nvoip_voice_disabled");
    if (!contact.phone?.trim()) throw new Error("Contact has no phone");
    await deliverNvoipVoiceTorpedo({
      campaign,
      contact,
      body,
      actorUserId,
    });
    return;
  }

  const inboxId = await resolveInboxId(campaign.organizationId, channel, campaign.inboxId);
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId: campaign.organizationId },
  });
  const expectedInboxType = mapChannelToInboxType(channel);
  if (expectedInboxType && inbox && inbox.channelType !== expectedInboxType) {
    throw new Error(
      `Selected inbox uses ${inbox.channelType} but campaign channel is ${channel}. Pick a matching inbox.`,
    );
  }
  if (payload.messageType === "TEMPLATE" && channel === "WHATSAPP" && inbox?.channelType !== "WHATSAPP") {
    throw new Error("WhatsApp templates require a WhatsApp inbox");
  }

  let sendInput: SendMessageInput;
  if (payload.messageType === "TEMPLATE" && payload.templateId) {
    const tpl = await prisma.messageTemplate.findFirst({
      where: { id: payload.templateId, organizationId: campaign.organizationId },
    });
    let templateBodyParameters: string[] | undefined;
    if (tpl && tpl.bodyVariableCount > 0) {
      const firstName = contact.name.trim().split(/\s+/)[0] || contact.name.trim() || "";
      templateBodyParameters = Array.from({ length: tpl.bodyVariableCount }, (_, i) =>
        i === 0 ? firstName : "",
      );
    }
    sendInput = {
      contactId: contact.id,
      type: "TEMPLATE",
      templateId: payload.templateId,
      inboxId,
      ...(templateBodyParameters ? { templateBodyParameters } : {}),
    };
  } else {
    sendInput = { contactId: contact.id, type: "TEXT", body, inboxId };
  }

  const { message, conversation: outboundConversation } = await deliverOutboundWhatsAppMessage({
    organizationId: campaign.organizationId,
    data: sendInput,
    actor: { kind: "user", userId: actorUserId },
    log,
    newConversation: newConversationForCampaign(campaign, actorUserId),
    postSendConversationPolicy: postSendPolicyForCampaign(campaign),
  });

  const segmentRules = parseSegmentRules(campaign.segmentRules);
  if (
    segmentRules?.campaignKind === "followup" &&
    message.status === "SENT" &&
    channel === "WHATSAPP"
  ) {
    const agentCtx = await getAgentBotDispatchContextForInbox(campaign.organizationId, inboxId);
    if (agentCtx?.agentBotId) {
      const tpl =
        payload.messageType === "TEMPLATE" && payload.templateId
          ? await prisma.messageTemplate.findFirst({
              where: { id: payload.templateId, organizationId: campaign.organizationId },
              select: { name: true },
            })
          : null;
      try {
        await seedFollowUpCampaignAutomationContext({
          organizationId: campaign.organizationId,
          conversationId: outboundConversation.id,
          botId: agentCtx.agentBotId,
          campaign: { id: campaign.id, name: campaign.name },
          outboundMessage: message,
          messageType: payload.messageType,
          templateId: payload.templateId ?? null,
          templateName: tpl?.name ?? null,
        });
      } catch (err) {
        log.warn(
          { err, campaignId: campaign.id, conversationId: outboundConversation.id },
          "follow-up: failed to seed automation conversation context",
        );
      }
    }
  }

  if (channel === "WHATSAPP" && message.status === "FAILED") {
    const providerKind = await getWhatsappProviderKindForInbox(campaign.organizationId, inboxId);
    if (providerKind === "evolution" || providerKind === "evolution_go") {
      throw new Error(
        "Falha ao enviar pelo WhatsApp (Evolution). Confirme que a instância está ligada e o modelo existe na caixa.",
      );
    }
    throw new Error(
      "WhatsApp delivery failed. Confirm the inbox uses Meta Cloud API and the template is synced for that number.",
    );
  }
}

export function resolvePayloadForRecipient(
  campaign: BroadcastCampaign,
  abVariant: string | null,
): CampaignSendPayload {
  const ab = campaign.abConfig as { enabled?: boolean; variantA?: BroadcastAbVariantPayload; variantB?: BroadcastAbVariantPayload } | null;
  if (ab?.enabled && abVariant === "B" && ab.variantB) {
    return {
      body: ab.variantB.body ?? campaign.body,
      templateId: ab.variantB.templateId ?? campaign.templateId,
      messageType: ab.variantB.templateId ? "TEMPLATE" : "TEXT",
      subject: ab.variantB.subject ?? campaign.subject,
    };
  }
  if (ab?.enabled && abVariant === "A" && ab.variantA) {
    return {
      body: ab.variantA.body ?? campaign.body,
      templateId: ab.variantA.templateId ?? campaign.templateId,
      messageType: ab.variantA.templateId ? "TEMPLATE" : "TEXT",
      subject: ab.variantA.subject ?? campaign.subject,
    };
  }
  return {
    body: campaign.body,
    templateId: campaign.templateId,
    messageType: campaign.messageType as "TEXT" | "TEMPLATE",
    subject: campaign.subject,
  };
}
