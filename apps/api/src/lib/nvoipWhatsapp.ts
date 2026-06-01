import type { NvoipAccount } from "@prisma/client";
import { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import {
  isInboxWhatsappConfigured,
  isMetaCloudWhatsappProvider,
  parseInboxWhatsappFromChannelConfig,
} from "./inboxWhatsappConfig.js";
import { normalizeDialPhone } from "./nvoipCallContext.js";
import {
  nvoipListWaTemplates,
  nvoipSendWaTemplate,
  type NvoipWaTemplateItem,
} from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { requireConnectedNvoipAccount } from "./nvoipSms.js";
import { appendTimelineEvent } from "./timeline.js";

export type NvoipWhatsappBlockedReason =
  | "nvoip_whatsapp_disabled"
  | "meta_inbox_configured"
  | "nvoip_not_configured"
  | "nvoip_not_connected"
  | "wa_instance_missing";

export async function orgHasConfiguredMetaWhatsappInbox(organizationId: string): Promise<boolean> {
  const inboxes = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { channelConfig: true },
  });
  for (const ib of inboxes) {
    const parsed = parseInboxWhatsappFromChannelConfig(ib.channelConfig);
    if (isMetaCloudWhatsappProvider(parsed.whatsappProvider) && isInboxWhatsappConfigured(parsed)) {
      return true;
    }
  }
  return false;
}

export async function getNvoipWhatsappAvailability(organizationId: string): Promise<{
  flagEnabled: boolean;
  available: boolean;
  blockedReason: NvoipWhatsappBlockedReason | null;
  hasMetaInbox: boolean;
  waInstance: string | null;
}> {
  const flagEnabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_whatsapp");
  const hasMetaInbox = await orgHasConfiguredMetaWhatsappInbox(organizationId);

  if (!flagEnabled) {
    return {
      flagEnabled: false,
      available: false,
      blockedReason: "nvoip_whatsapp_disabled",
      hasMetaInbox,
      waInstance: null,
    };
  }

  if (hasMetaInbox) {
    return {
      flagEnabled: true,
      available: false,
      blockedReason: "meta_inbox_configured",
      hasMetaInbox: true,
      waInstance: null,
    };
  }

  const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
  if (!account) {
    return {
      flagEnabled: true,
      available: false,
      blockedReason: "nvoip_not_configured",
      hasMetaInbox: false,
      waInstance: null,
    };
  }

  if (account.status !== "CONNECTED") {
    return {
      flagEnabled: true,
      available: false,
      blockedReason: "nvoip_not_connected",
      hasMetaInbox: false,
      waInstance: account.waInstance,
    };
  }

  if (!account.waInstance?.trim()) {
    return {
      flagEnabled: true,
      available: false,
      blockedReason: "wa_instance_missing",
      hasMetaInbox: false,
      waInstance: null,
    };
  }

  return {
    flagEnabled: true,
    available: true,
    blockedReason: null,
    hasMetaInbox: false,
    waInstance: account.waInstance.trim(),
  };
}

export async function assertNvoipWhatsappAvailable(organizationId: string): Promise<NvoipAccount> {
  const availability = await getNvoipWhatsappAvailability(organizationId);
  if (!availability.available) {
    throw new Error(availability.blockedReason ?? "nvoip_whatsapp_unavailable");
  }
  return requireConnectedNvoipAccount(organizationId);
}

export async function listNvoipWhatsappTemplates(
  organizationId: string,
): Promise<NvoipWaTemplateItem[]> {
  const account = await assertNvoipWhatsappAvailable(organizationId);
  return nvoipListWaTemplates(account);
}

export async function sendNvoipWhatsappTemplate(input: {
  organizationId: string;
  phone: string;
  idTemplate: string;
  functions?: string[];
  language?: string;
  instance?: string;
  contactId?: string;
  actorUserId?: string;
  templateName?: string;
}): Promise<Record<string, unknown>> {
  const account = await assertNvoipWhatsappAvailable(input.organizationId);
  const destination = normalizeDialPhone(input.phone);
  if (!destination) throw new Error("invalid_phone");

  const instance = (input.instance ?? account.waInstance ?? "").trim();
  if (!instance) throw new Error("wa_instance_missing");

  const language = (input.language ?? account.waDefaultLanguage ?? "pt_BR").trim() || "pt_BR";
  const functions = (input.functions ?? []).map((f) => f.trim()).filter(Boolean);

  const raw = await nvoipSendWaTemplate(account, {
    idTemplate: input.idTemplate.trim(),
    destination,
    instance,
    language,
    functions,
  });

  if (input.contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: input.contactId,
      eventType: "nvoip_wa_template",
      channel: "NVOIP_WHATSAPP",
      actorUserId: input.actorUserId ?? null,
      payload: {
        title: input.templateName
          ? `WhatsApp template — ${input.templateName}`
          : "WhatsApp template (Nvoip)",
        idTemplate: input.idTemplate,
        phone: destination,
        language,
        functions,
      },
    });
  }

  await writeNvoipIntegrationLog({
    organizationId: input.organizationId,
    nvoipAccountId: account.id,
    level: "info",
    eventType: "wa_template_sent",
    message: `WA template ${input.idTemplate} → ${destination}`,
  });

  return raw;
}
