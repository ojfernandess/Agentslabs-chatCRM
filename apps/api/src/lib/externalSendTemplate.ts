import { z } from "zod";
import { InboxChannelType } from "@prisma/client";
import { normalizePhoneE164 } from "@openconduit/shared";
import { prisma } from "../db.js";
import type { MessageTemplate } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import {
  findWhatsappInboxByPhoneNumberId,
  parseInboxWhatsappFromChannelConfig,
} from "./inboxWhatsappConfig.js";
import { deliverOutboundWhatsAppMessage, type PostSendConversationPolicy } from "./outboundMessage.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import { resolveUserOrganizationId } from "./tenantContext.js";
import type { JwtPayload } from "../middleware/auth.js";
import {
  extractTemplateBodyParametersFromMetaComponents,
  normalizeExternalSendTemplatePayload,
  phoneDigitsOnly,
  sanitizeMetaTemplateComponentsForSend,
  type ExternalSendTemplateBody,
} from "./externalSendTemplateHelpers.js";

export {
  externalSendTemplateBodySchema,
  normalizeExternalSendTemplatePayload,
  extractTemplateBodyParametersFromMetaComponents,
  sanitizeMetaTemplateComponentsForSend,
  phoneDigitsOnly,
} from "./externalSendTemplateHelpers.js";
export type { ExternalSendTemplateBody } from "./externalSendTemplateHelpers.js";

export async function resolveExternalSendTemplateOrganizationId(
  user: JwtPayload,
  bodyOrganizationId?: string,
): Promise<{ organizationId: string } | { statusCode: number; message: string }> {
  const bodyOrg = bodyOrganizationId?.trim() || undefined;
  const headerOrg =
    user.role === "SUPER_ADMIN" ? user.actingOrganizationId?.trim() || undefined : undefined;
  const tokenOrg =
    user.role === "SUPER_ADMIN" ? undefined : (await resolveUserOrganizationId(user)) ?? undefined;

  if (bodyOrg && headerOrg && bodyOrg !== headerOrg) {
    return {
      statusCode: 400,
      message: "organizationId in body does not match Organization-Id header",
    };
  }

  const targetOrg = bodyOrg ?? headerOrg ?? tokenOrg;
  if (!targetOrg) {
    return {
      statusCode: 403,
      message:
        user.role === "SUPER_ADMIN"
          ? "Provide organizationId in the request body or Organization-Id header"
          : "Provide organizationId in the request body or use an API token bound to an organization",
    };
  }

  if (user.role !== "SUPER_ADMIN") {
    const allowedOrg = tokenOrg ?? (await resolveUserOrganizationId(user));
    if (allowedOrg && targetOrg !== allowedOrg) {
      return {
        statusCode: 403,
        message: "organizationId does not match your API token organization",
      };
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: targetOrg },
    select: { isActive: true },
  });
  if (!org?.isActive) {
    return { statusCode: 403, message: "Organization not found or suspended" };
  }

  return { organizationId: targetOrg };
}

export async function resolveWhatsappInboxForExternalSend(
  organizationId: string,
  options?: { inboxId?: string | null; from?: string | null },
): Promise<{ id: string } | null> {
  const inboxId = options?.inboxId?.trim();
  if (inboxId) {
    return prisma.inbox.findFirst({
      where: { id: inboxId, organizationId, channelType: InboxChannelType.WHATSAPP },
      select: { id: true },
    });
  }

  const from = options?.from;
  if (!from?.trim()) {
    const defaultInbox = await prisma.inbox.findFirst({
      where: { organizationId, channelType: InboxChannelType.WHATSAPP, isDefault: true },
      select: { id: true },
    });
    if (defaultInbox) return defaultInbox;
    return prisma.inbox.findFirst({
      where: { organizationId, channelType: InboxChannelType.WHATSAPP },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
  }

  const needle = from.trim();
  if (z.string().uuid().safeParse(needle).success) {
    const byId = await prisma.inbox.findFirst({
      where: { id: needle, organizationId, channelType: InboxChannelType.WHATSAPP },
      select: { id: true },
    });
    if (byId) return byId;
  }

  const byPhoneNumberId = await findWhatsappInboxByPhoneNumberId(organizationId, needle);
  if (byPhoneNumberId) return { id: byPhoneNumberId.id };

  const digits = phoneDigitsOnly(needle);
  if (!digits) return null;

  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, channelConfig: true, isDefault: true, createdAt: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  for (const row of rows) {
    const parsed = parseInboxWhatsappFromChannelConfig(row.channelConfig);
    const display = parsed.whatsappDisplayPhone ? phoneDigitsOnly(parsed.whatsappDisplayPhone) : "";
    if (display && display === digits) return { id: row.id };
    const pnid = parsed.whatsappPhoneNumberId?.trim();
    if (pnid && phoneDigitsOnly(pnid) === digits) return { id: row.id };
  }

  return null;
}

export async function resolveMessageTemplateForExternalSend(
  organizationId: string,
  templateIdRaw: string,
): Promise<MessageTemplate | null> {
  const raw = templateIdRaw.trim();
  if (!raw) return null;

  if (z.string().uuid().safeParse(raw).success) {
    const byUuid = await prisma.messageTemplate.findFirst({ where: { id: raw, organizationId } });
    if (byUuid) return byUuid;
  }

  const byProvider = await prisma.messageTemplate.findFirst({
    where: { organizationId, providerTemplateId: raw },
  });
  if (byProvider) return byProvider;

  return prisma.messageTemplate.findFirst({
    where: { organizationId, name: raw },
  });
}

export async function findOrCreateContactByPhoneForExternalSend(
  organizationId: string,
  phoneRaw: string,
  displayName?: string,
): Promise<{ contact: { id: string; phone: string; name: string }; created: boolean }> {
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) {
    throw new Error("Invalid phone number format");
  }

  const existing = await prisma.contact.findFirst({
    where: { organizationId, phone },
    select: { id: true, phone: true, name: true },
  });
  if (existing) {
    return { contact: existing, created: false };
  }

  const contact = await prisma.contact.create({
    data: {
      organizationId,
      phone,
      name: displayName?.trim() || phone,
    },
    select: { id: true, phone: true, name: true },
  });
  return { contact, created: true };
}

function postSendPolicyForInboxType(inboxType: "ai" | "human"): PostSendConversationPolicy {
  return inboxType === "ai" ? "bot_queue" : "human_handoff";
}

export async function executeExternalSendTemplate(options: {
  organizationId: string;
  userId: string;
  payload: ReturnType<typeof normalizeExternalSendTemplatePayload>;
  log: FastifyBaseLogger;
}): Promise<{
  ok: true;
  organizationId: string;
  messageId: string;
  conversationId: string;
  contactId: string;
  contactCreated: boolean;
  sentToWhatsapp: boolean;
  inboxId: string;
  templateId: string;
}> {
  const { organizationId, userId, payload, log } = options;

  if (payload.recipient && !payload.to) {
    throw new Error("recipient BSUID is not supported; use to with an international phone number");
  }

  const phoneRaw = payload.to;
  if (!phoneRaw) {
    throw new Error("to is required");
  }

  const templateRow = await resolveMessageTemplateForExternalSend(organizationId, payload.templateId);
  if (!templateRow) {
    throw new Error("Template not found");
  }

  let inbox = await resolveWhatsappInboxForExternalSend(organizationId, {
    inboxId: payload.inboxId,
    from: payload.from,
  });
  if (!inbox && payload.inboxId) {
    throw new Error("Inbox not found");
  }
  if (!inbox) {
    const fallbackId = await getDefaultInboxId(organizationId);
    inbox = { id: fallbackId };
  }

  const { contact, created: contactCreated } = await findOrCreateContactByPhoneForExternalSend(
    organizationId,
    phoneRaw,
  );

  const bodyParams = extractTemplateBodyParametersFromMetaComponents(payload.components);
  const metaComponents = payload.components?.length
    ? sanitizeMetaTemplateComponentsForSend(payload.components as Array<Record<string, unknown>>)
    : undefined;

  if (!metaComponents?.length && templateRow.bodyVariableCount > 0 && bodyParams.length !== templateRow.bodyVariableCount) {
    throw new Error(
      `Template requires exactly ${templateRow.bodyVariableCount} body variable(s); got ${bodyParams.length} in components`,
    );
  }

  if (payload.sendToWA && !templateRow.providerTemplateId?.trim()) {
    throw new Error(
      "Template is missing WhatsApp Business template name (providerTemplateId). Sync templates via GET /api/v1/templates first.",
    );
  }

  const { message, conversation } = await deliverOutboundWhatsAppMessage({
    organizationId,
    data: {
      contactId: contact.id,
      inboxId: inbox.id,
      type: "TEMPLATE",
      templateId: templateRow.id,
      templateBodyParameters: bodyParams.length > 0 ? bodyParams : undefined,
    },
    actor: { kind: "user", userId },
    log,
    newConversation: { status: "OPEN", assignedToId: null },
    postSendConversationPolicy: postSendPolicyForInboxType(payload.inboxType),
    skipWhatsappProviderDelivery: !payload.sendToWA,
    templateMetaComponents: metaComponents,
  });

  if (payload.sendToWA && message.status === "FAILED") {
    throw new Error("WhatsApp template delivery failed");
  }

  return {
    ok: true,
    organizationId,
    messageId: message.id,
    conversationId: conversation.id,
    contactId: contact.id,
    contactCreated,
    sentToWhatsapp: payload.sendToWA && message.status === "SENT",
    inboxId: inbox.id,
    templateId: templateRow.id,
  };
}

export function mapExternalSendTemplateError(err: unknown): { statusCode: number; message: string } {
  const msg = err instanceof Error ? err.message : "Request failed";
  if (msg === "Invalid phone number format") return { statusCode: 400, message: msg };
  if (msg.startsWith("recipient BSUID")) return { statusCode: 400, message: msg };
  if (msg === "Template not found") return { statusCode: 404, message: msg };
  if (msg === "Inbox not found") return { statusCode: 404, message: msg };
  if (msg === "Contact is blocked") return { statusCode: 403, message: msg };
  if (msg.includes("Template requires exactly")) return { statusCode: 400, message: msg };
  if (msg.includes("providerTemplateId") || msg.includes("WhatsApp Business")) return { statusCode: 422, message: msg };
  if (msg.includes("session window") || msg.includes("Meta API")) return { statusCode: 422, message: msg };
  if (msg === "WhatsApp template delivery failed") return { statusCode: 422, message: msg };
  return { statusCode: 500, message: msg };
}
