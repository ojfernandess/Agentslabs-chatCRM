import { prisma } from "../db.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";
import {
  ensureConversationForChannelInbox,
  reopenResolvedConversationData,
} from "./conversationRouting.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import { normalizeDialPhone } from "./wavoipCallContext.js";
import { placeholderWhatsappCallId } from "./wavoipAgentCall.js";
import { upsertWavoipTimelineMessage } from "./wavoipCallTimeline.js";
import { broadcastConversationUpdated, broadcastToOrganization } from "./workspaceHub.js";
import { resolveIncomingCallTargetUserIds } from "./wavoipIncomingQueue.js";
import { logWavoipIntegration } from "./wavoipIntegrationLog.js";

async function resolveInboxIdForDevice(device: { inboxId: string | null }, organizationId: string): Promise<string> {
  if (device.inboxId) return device.inboxId;
  return getDefaultInboxId(organizationId);
}

export async function ensureContactForInboundCall(
  organizationId: string,
  peerPhoneRaw: string,
  deviceLinkedPhone: string | null,
  displayName?: string | null,
): Promise<{ contactId: string; created: boolean } | null> {
  const normalized = normalizeDialPhone(peerPhoneRaw);
  if (!normalized) return null;

  let contact = await findContactByInboundPhone(prisma, organizationId, normalized);
  if (contact) {
    const name = displayName?.trim();
    if (name && name !== contact.name && name !== normalized) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { name: name.slice(0, 255) },
      });
    }
    return { contactId: contact.id, created: false };
  }

  try {
    contact = await prisma.contact.create({
      data: {
        organizationId,
        phone: normalized,
        name: (displayName?.trim() || normalized).slice(0, 255),
        notes: deviceLinkedPhone ? `[Wavoip] Chamada vinculada ao device ${deviceLinkedPhone}` : "[Wavoip] Contato via chamada",
      },
    });
    return { contactId: contact.id, created: true };
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "P2002") {
      contact = await findContactByInboundPhone(prisma, organizationId, normalized);
      if (contact) return { contactId: contact.id, created: false };
    }
    throw err;
  }
}

/** Coloca conversa na fila (PENDING) ao tocar — screen pop estilo CRM. */
export async function touchConversationForInboundCall(
  conversationId: string,
  isTerminal: boolean,
): Promise<void> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true },
  });
  if (!conv) return;

  if (isTerminal) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return;
  }

  if (conv.status === "RESOLVED") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: reopenResolvedConversationData("PENDING"),
    });
    return;
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: "PENDING", updatedAt: new Date() },
  });
}

export type WavoipInboundScreenPopResult = {
  contactId: string | null;
  conversationId: string | null;
  contactName: string | null;
  whatsappCallId: number;
  caller: string;
  receiver: string;
};

/**
 * Garante contacto, conversa PENDING, mensagem na timeline e WS — usado pelo webhook e pelo browser (SDK offer).
 */
export async function runWavoipInboundScreenPop(input: {
  organizationId: string;
  wavoipDeviceId: string;
  callerPhone: string;
  clientCallId?: string | null;
  whatsappCallId?: number | null;
  displayName?: string | null;
  broadcastWs?: boolean;
}): Promise<WavoipInboundScreenPopResult | null> {
  const device = await prisma.wavoipDevice.findFirst({
    where: { id: input.wavoipDeviceId, organizationId: input.organizationId },
    select: {
      id: true,
      organizationId: true,
      inboxId: true,
      linkedPhone: true,
      assignedUserId: true,
      externalConfig: true,
    },
  });
  if (!device) return null;

  const caller = input.callerPhone.trim().slice(0, 32);
  const receiver = (device.linkedPhone ?? "").trim().slice(0, 32);
  if (!caller) return null;

  const contactResult = await ensureContactForInboundCall(
    device.organizationId,
    caller,
    device.linkedPhone,
    input.displayName,
  );
  if (!contactResult) return null;

  const settings = await prisma.settings.findUnique({
    where: { organizationId: device.organizationId },
  });
  const inboxId = await resolveInboxIdForDevice(device, device.organizationId);
  const conv = await ensureConversationForChannelInbox({
    organizationId: device.organizationId,
    contactId: contactResult.contactId,
    inboxId,
    lockSingleConversation: settings?.lockSingleConversation ?? true,
    activeConversationStatus: "PENDING",
    createDefaults: { status: "PENDING" },
  });

  const conversationId = conv.id;
  await touchConversationForInboundCall(conversationId, false);

  const clientCallId = input.clientCallId?.trim() || null;
  let whatsappCallId =
    input.whatsappCallId != null && Number.isFinite(input.whatsappCallId)
      ? Math.trunc(input.whatsappCallId)
      : null;

  if (whatsappCallId == null && clientCallId) {
    whatsappCallId = placeholderWhatsappCallId(clientCallId);
  }
  if (whatsappCallId == null) {
    whatsappCallId = placeholderWhatsappCallId(`${device.id}:${caller}:${Date.now()}`);
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
      idSession: 0,
      direction: "INCOMING",
      caller,
      receiver,
      status: "RINGING",
      contactId: contactResult.contactId,
      conversationId,
      clientCallId,
      startedAt: new Date(),
    },
    update: {
      status: "RINGING",
      contactId: contactResult.contactId,
      conversationId,
      clientCallId: clientCallId ?? undefined,
      endedAt: null,
    },
  });

  const messageId = await upsertWavoipTimelineMessage({
    conversationId,
    whatsappCallId,
    clientCallId,
    direction: "INCOMING",
    status: "RINGING",
    caller,
    receiver,
    durationSec: null,
    recordUrl: null,
  });

  if (messageId && messageId !== callLog.messageId) {
    await prisma.wavoipCallLog.update({
      where: { id: callLog.id },
      data: { messageId },
    });
  }

  broadcastConversationUpdated(device.organizationId, conversationId);

  const contact = await prisma.contact.findUnique({
    where: { id: contactResult.contactId },
    select: { name: true },
  });
  const contactName = contact?.name ?? null;

  if (input.broadcastWs !== false) {
    const targetUserIds = await resolveIncomingCallTargetUserIds(device, device.organizationId);
    broadcastToOrganization(device.organizationId, {
      type: "wavoip.call.incoming",
      deviceId: device.id,
      whatsappCallId,
      caller,
      receiver,
      contactId: contactResult.contactId,
      conversationId,
      contactName,
      targetUserIds,
    });
  }

  await logWavoipIntegration({
    organizationId: device.organizationId,
    wavoipDeviceId: device.id,
    level: "info",
    eventType: "screen_pop",
    message: `Inbound screen pop — ${caller} → conversa ${conversationId.slice(0, 8)}`,
    payload: { clientCallId, whatsappCallId } as Record<string, unknown>,
  });

  return {
    contactId: contactResult.contactId,
    conversationId,
    contactName,
    whatsappCallId,
    caller,
    receiver,
  };
}
