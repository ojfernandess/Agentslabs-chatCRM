import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { normalizePhoneE164 } from "@openconduit/shared";
import { prisma } from "../db.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";
import { ensureConversationForChannelInbox } from "./conversationRouting.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import { fireBroadcastEventTriggers } from "./broadcastEventHooks.js";
import { broadcastConversationUpdated, broadcastToOrganization } from "./workspaceHub.js";
import { appendTimelineEvent } from "./timeline.js";
import { decryptWavoipSecret, mapWavoipWebhookDeviceStatus, parseWebhookEventsJson } from "./wavoipDeviceConfig.js";
import { logWavoipIntegration } from "./wavoipIntegrationLog.js";
import { upsertWavoipTimelineMessage } from "./wavoipCallTimeline.js";
import { dispatchWavoipOutboundIntegrations } from "./wavoipOutboundIntegrations.js";
import { findProvisionalCallLog } from "./wavoipAgentCall.js";

type WavoipWebhookPayload = {
  type?: string;
  action?: string;
  whatsapp_call_id?: number;
  id_session?: number;
  caller?: string;
  receiver?: string;
  status?: string;
  direction?: string;
  duration?: number;
  record_status?: string;
  record_url?: string;
  phone?: string;
};

function asPayload(body: unknown): WavoipWebhookPayload {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as WavoipWebhookPayload;
  }
  return {};
}

function eventEnabled(deviceEvents: string[], type: string): boolean {
  if (deviceEvents.length === 0) return true;
  return deviceEvents.includes(type.toUpperCase());
}

async function resolveInboxIdForDevice(device: { inboxId: string | null }, organizationId: string): Promise<string> {
  if (device.inboxId) return device.inboxId;
  return getDefaultInboxId(organizationId);
}

async function ensureContactForCall(
  organizationId: string,
  peerPhoneRaw: string,
  deviceLinkedPhone: string | null,
): Promise<{ contactId: string; created: boolean } | null> {
  const normalized = normalizePhoneE164(peerPhoneRaw);
  if (!normalized) return null;

  let contact = await findContactByInboundPhone(prisma, organizationId, normalized);
  if (contact) return { contactId: contact.id, created: false };

  contact = await prisma.contact.create({
    data: {
      organizationId,
      phone: normalized,
      name: normalized,
      notes: deviceLinkedPhone ? `[Wavoip] Chamada vinculada ao device ${deviceLinkedPhone}` : "[Wavoip] Contato via chamada",
    },
  });
  return { contactId: contact.id, created: true };
}

async function handleDeviceEvent(
  device: {
    id: string;
    organizationId: string;
    name: string;
    inboxId: string | null;
    linkedPhone: string | null;
    outboundIntegrations: unknown;
    webhookEvents: unknown;
  },
  payload: WavoipWebhookPayload,
): Promise<void> {
  if (!eventEnabled(parseWebhookEventsJson(device.webhookEvents), "DEVICE")) return;

  const status = mapWavoipWebhookDeviceStatus(payload.status);
  const phone = payload.phone?.trim() || undefined;

  await prisma.wavoipDevice.update({
    where: { id: device.id },
    data: {
      status,
      ...(phone ? { linkedPhone: phone.slice(0, 32) } : {}),
      lastStatusAt: new Date(),
      lastError: status === "ERROR" || status === "EXTERNAL_INTEGRATION_ERROR" ? payload.status ?? "error" : null,
    },
  });

  broadcastToOrganization(device.organizationId, {
    type: "wavoip.device.updated",
    deviceId: device.id,
    status,
    linkedPhone: phone ?? null,
  });

  await logWavoipIntegration({
    organizationId: device.organizationId,
    wavoipDeviceId: device.id,
    level: "info",
    eventType: "webhook_device",
    message: `Device status → ${status}${phone ? ` (${phone})` : ""}`,
    payload: payload as Record<string, unknown>,
  });

  void dispatchWavoipOutboundIntegrations({
    organizationId: device.organizationId,
    device: {
      id: device.id,
      name: device.name,
      linkedPhone: phone ?? device.linkedPhone,
      inboxId: device.inboxId,
      outboundIntegrations: device.outboundIntegrations,
    },
    eventType: "DEVICE",
    payload: { status, linkedPhone: phone ?? device.linkedPhone, raw: payload as Record<string, unknown> },
  }).catch(() => {});
}

async function handleCallEvent(
  app: FastifyInstance,
  device: {
    id: string;
    organizationId: string;
    name: string;
    inboxId: string | null;
    linkedPhone: string | null;
    outboundIntegrations: unknown;
    webhookEvents: unknown;
  },
  payload: WavoipWebhookPayload,
): Promise<void> {
  if (!eventEnabled(parseWebhookEventsJson(device.webhookEvents), "CALL")) return;

  const whatsappCallId = payload.whatsapp_call_id;
  const idSession = payload.id_session;
  if (whatsappCallId == null || idSession == null) return;

  const caller = (payload.caller ?? "").trim();
  const receiver = (payload.receiver ?? "").trim();
  const direction = (payload.direction ?? "INCOMING").toUpperCase();
  const status = (payload.status ?? "NONE").toUpperCase();
  const durationSec = typeof payload.duration === "number" ? payload.duration : null;

  const peerPhone = direction === "INCOMING" ? caller : receiver;
  const contactResult = await ensureContactForCall(device.organizationId, peerPhone, device.linkedPhone);

  let conversationId: string | null = null;
  let contactId: string | null = contactResult?.contactId ?? null;

  if (contactId) {
    const settings = await prisma.settings.findUnique({ where: { organizationId: device.organizationId } });
    const inboxId = await resolveInboxIdForDevice(device, device.organizationId);
    const conv = await ensureConversationForChannelInbox({
      organizationId: device.organizationId,
      contactId,
      inboxId,
      lockSingleConversation: settings?.lockSingleConversation ?? true,
      activeConversationStatus: "OPEN",
      createDefaults: { status: "OPEN" },
    });
    conversationId = conv.id;

    if (contactResult?.created) {
      fireBroadcastEventTriggers(app, device.organizationId, "NEW_LEAD", { contactId });
    }
  }

  const now = new Date();
  const isTerminal = ["ENDED", "REJECTED", "NOT_ANSWERED", "FAILED"].includes(status);

  let initiatedByUserId: string | null = null;
  let clientCallId: string | null = null;
  const provisional = await findProvisionalCallLog(device.id, contactId);
  if (provisional && direction === "OUTGOING") {
    initiatedByUserId = provisional.initiatedByUserId;
    clientCallId = provisional.clientCallId;
    conversationId = provisional.conversationId ?? conversationId;
    await prisma.wavoipCallLog.delete({ where: { id: provisional.id } });
  }

  const callLog = await prisma.wavoipCallLog.upsert({
    where: {
      wavoipDeviceId_whatsappCallId: {
        wavoipDeviceId: device.id,
        whatsappCallId,
      },
    },
    create: {
      organizationId: device.organizationId,
      wavoipDeviceId: device.id,
      whatsappCallId,
      idSession,
      direction,
      caller: caller.slice(0, 32),
      receiver: receiver.slice(0, 32),
      status,
      durationSec,
      recordStatus: payload.record_status ?? null,
      contactId,
      conversationId,
      initiatedByUserId,
      clientCallId,
      startedAt: payload.action === "CREATE" ? now : null,
      endedAt: isTerminal ? now : null,
      rawPayload: payload as Prisma.InputJsonValue,
    },
    update: {
      status,
      durationSec,
      recordStatus: payload.record_status ?? undefined,
      contactId: contactId ?? undefined,
      conversationId: conversationId ?? undefined,
      initiatedByUserId: initiatedByUserId ?? undefined,
      clientCallId: clientCallId ?? undefined,
      endedAt: isTerminal ? now : undefined,
      rawPayload: payload as Prisma.InputJsonValue,
    },
  });

  let messageId: string | null = callLog.messageId;
  if (conversationId && !messageId) {
    messageId = await upsertWavoipTimelineMessage({
      conversationId,
      whatsappCallId,
      direction,
      status,
      caller,
      receiver,
      durationSec,
      recordUrl: null,
    });
    if (messageId) {
      await prisma.wavoipCallLog.update({
        where: { id: callLog.id },
        data: { messageId },
      });
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      broadcastConversationUpdated(device.organizationId, conversationId);
    }
  }

  const isIncomingRing =
    direction === "INCOMING" &&
    !isTerminal &&
    (status === "RINGING" || payload.action === "CREATE" || status === "NONE");

  if (isIncomingRing) {
    broadcastToOrganization(device.organizationId, {
      type: "wavoip.call.incoming",
      deviceId: device.id,
      whatsappCallId,
      caller: caller.slice(0, 32),
      receiver: receiver.slice(0, 32),
      contactId,
      conversationId,
      contactName: null,
    });
  }

  if (contactId) {
    let agentName: string | null = null;
    if (callLog.initiatedByUserId) {
      const agent = await prisma.user.findUnique({
        where: { id: callLog.initiatedByUserId },
        select: { name: true },
      });
      agentName = agent?.name ?? null;
    }
    await appendTimelineEvent({
      organizationId: device.organizationId,
      subjectType: "CONTACT",
      subjectId: contactId,
      eventType: "wavoip_call",
      channel: "WAVOIP",
      actorUserId: callLog.initiatedByUserId,
      payload: {
        title: `Chamada Wavoip — ${status}`,
        whatsappCallId,
        direction,
        status,
        durationSec,
        agentName,
      },
    });
  }

  await logWavoipIntegration({
    organizationId: device.organizationId,
    wavoipDeviceId: device.id,
    level: "info",
    eventType: "webhook_call",
    message: `Call ${whatsappCallId} ${payload.action ?? "UPDATE"} → ${status}`,
    payload: payload as Record<string, unknown>,
  });

  let contact: { id: string; name: string; phone: string | null } | null = null;
  if (contactId) {
    contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, name: true, phone: true },
    });
  }

  void dispatchWavoipOutboundIntegrations({
    organizationId: device.organizationId,
    device: {
      id: device.id,
      name: device.name,
      linkedPhone: device.linkedPhone,
      inboxId: device.inboxId,
      outboundIntegrations: device.outboundIntegrations,
    },
    eventType: "CALL",
    payload: {
      whatsappCallId,
      idSession,
      direction,
      status,
      durationSec,
      action: payload.action ?? null,
      caller,
      receiver,
    },
    contactId,
    conversationId,
    contact,
  }).catch(() => {});
}

async function handleRecordEvent(
  device: {
    id: string;
    organizationId: string;
    name: string;
    inboxId: string | null;
    linkedPhone: string | null;
    outboundIntegrations: unknown;
    webhookEvents: unknown;
  },
  payload: WavoipWebhookPayload,
): Promise<void> {
  if (!eventEnabled(parseWebhookEventsJson(device.webhookEvents), "RECORD")) return;

  const whatsappCallId = payload.whatsapp_call_id;
  if (whatsappCallId == null) return;

  const callLog = await prisma.wavoipCallLog.findUnique({
    where: {
      wavoipDeviceId_whatsappCallId: {
        wavoipDeviceId: device.id,
        whatsappCallId,
      },
    },
  });
  if (!callLog) return;

  const recordUrl = payload.record_url?.trim() || null;
  await prisma.wavoipCallLog.update({
    where: { id: callLog.id },
    data: {
      recordStatus: payload.record_status ?? undefined,
      recordUrl,
    },
  });

  if (callLog.conversationId && recordUrl && !callLog.messageId) {
    const messageId = await upsertWavoipTimelineMessage({
      conversationId: callLog.conversationId,
      whatsappCallId,
      direction: callLog.direction,
      status: "ENDED",
      caller: callLog.caller,
      receiver: callLog.receiver,
      durationSec: callLog.durationSec,
      recordUrl,
      mediaUrl: recordUrl,
    });
    if (messageId) {
      await prisma.wavoipCallLog.update({ where: { id: callLog.id }, data: { messageId } });
      broadcastConversationUpdated(device.organizationId, callLog.conversationId);
    }
  }

  await logWavoipIntegration({
    organizationId: device.organizationId,
    wavoipDeviceId: device.id,
    level: "info",
    eventType: "webhook_record",
    message: `Recording ${whatsappCallId} → ${payload.record_status ?? "update"}`,
    payload: payload as Record<string, unknown>,
  });

  void dispatchWavoipOutboundIntegrations({
    organizationId: device.organizationId,
    device: {
      id: device.id,
      name: device.name,
      linkedPhone: device.linkedPhone,
      inboxId: device.inboxId,
      outboundIntegrations: device.outboundIntegrations,
    },
    eventType: "RECORD",
    payload: {
      whatsappCallId,
      recordStatus: payload.record_status ?? null,
      recordUrl,
      conversationId: callLog.conversationId,
      contactId: callLog.contactId,
    },
    contactId: callLog.contactId,
    conversationId: callLog.conversationId,
  }).catch(() => {});
}

export function verifyWavoipWebhookSecret(
  device: { webhookSecretEnc: string | null },
  headerSecret: string | undefined,
): boolean {
  const expected = decryptWavoipSecret(device.webhookSecretEnc);
  if (!expected) return true;
  if (!headerSecret?.trim()) return false;
  return headerSecret.trim() === expected;
}

export async function handleWavoipWebhook(
  app: FastifyInstance,
  organizationId: string,
  deviceId: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: deviceId, organizationId },
  });
  if (!device) {
    return { ok: false, status: 404, message: "Device not found" };
  }
  if (!device.webhookEnabled) {
    return { ok: false, status: 403, message: "Webhook disabled" };
  }

  const payload = asPayload(body);
  const type = (payload.type ?? "").toUpperCase();

  try {
    if (type === "DEVICE") {
      await handleDeviceEvent(device, payload);
    } else if (type === "CALL") {
      await handleCallEvent(app, device, payload);
    } else if (type === "RECORD") {
      await handleRecordEvent(device, payload);
    } else {
      await logWavoipIntegration({
        organizationId,
        wavoipDeviceId: deviceId,
        level: "warn",
        eventType: "webhook_unknown",
        message: `Unknown webhook type: ${type || "(empty)"}`,
        payload: payload as Record<string, unknown>,
      });
    }
    return { ok: true };
  } catch (err) {
    await logWavoipIntegration({
      organizationId,
      wavoipDeviceId: deviceId,
      level: "error",
      eventType: "webhook_error",
      message: err instanceof Error ? err.message : "Webhook handler failed",
      payload: payload as Record<string, unknown>,
    });
    throw err;
  }
}
