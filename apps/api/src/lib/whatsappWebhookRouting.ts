import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import {
  findWhatsappInboxByPhoneNumberId,
  isMetaCloudWhatsappProvider,
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
} from "./inboxWhatsappConfig.js";
import { findEvolutionGoWhatsappInboxId, isEvolutionGoWebhookPayload } from "./evolutionGoPlatform.js";
import { extractMetaWebhookPhoneNumberId, isMetaCloudWebhookPayload } from "./metaWebhookPayload.js";

export type WhatsappWebhookTarget = {
  inboxId: string;
  whatsappProvider: string;
};

export { extractMetaWebhookPhoneNumberId, isMetaCloudWebhookPayload } from "./metaWebhookPayload.js";

/**
 * When Meta sends `phone_number_id` in the payload, always route to the matching inbox —
 * even if the webhook URL contains a different inbox id (common misconfiguration).
 */
export async function resolveWhatsappWebhookTarget(
  organizationId: string,
  options: { inboxId?: string; body?: unknown },
  log?: { warn: (obj: Record<string, unknown>, msg: string) => void },
): Promise<WhatsappWebhookTarget | null> {
  const phoneId = options.body ? extractMetaWebhookPhoneNumberId(options.body) : null;
  let inboxId = options.inboxId;

  if (phoneId) {
    const byPhone = await findWhatsappInboxByPhoneNumberId(organizationId, phoneId);
    if (byPhone) {
      if (inboxId && inboxId !== byPhone.id) {
        log?.warn(
          {
            organizationId,
            urlInboxId: inboxId,
            resolvedInboxId: byPhone.id,
            phoneNumberId: phoneId,
          },
          "Meta webhook routed by phone_number_id (URL inbox ignored)",
        );
      }
      inboxId = byPhone.id;
    } else {
      log?.warn(
        { organizationId, phoneNumberId: phoneId, urlInboxId: options.inboxId },
        "Meta webhook: phone_number_id not linked to any inbox in this organization",
      );
      return null;
    }
  }

  if (!inboxId && options.body && isEvolutionGoWebhookPayload(options.body)) {
    inboxId = (await findEvolutionGoWhatsappInboxId(organizationId)) ?? undefined;
  }

  if (inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxId, organizationId },
      select: { id: true, channelConfig: true },
    });
    if (!inbox) return null;
    const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
    if (!creds) return null;
    return { inboxId: inbox.id, whatsappProvider: creds.whatsappProvider };
  }

  const defaultInboxId = await getDefaultInboxId(organizationId);
  const defaultInbox = await prisma.inbox.findFirst({
    where: { id: defaultInboxId, organizationId },
    select: { id: true, channelConfig: true },
  });
  if (!defaultInbox) return null;
  const creds = await resolveInboxWhatsappCredentials(organizationId, defaultInbox);
  if (!creds) return null;
  return { inboxId: defaultInbox.id, whatsappProvider: creds.whatsappProvider };
}

export async function recordWhatsappInboundWebhook(inboxId: string): Promise<void> {
  const inbox = await prisma.inbox.findUnique({
    where: { id: inboxId },
    select: { channelConfig: true },
  });
  if (!inbox) return;
  const base =
    inbox.channelConfig && typeof inbox.channelConfig === "object" && !Array.isArray(inbox.channelConfig)
      ? { ...(inbox.channelConfig as Record<string, unknown>) }
      : {};
  base.whatsappLastInboundWebhookAt = new Date().toISOString();
  await prisma.inbox.update({
    where: { id: inboxId },
    data: { channelConfig: base as Prisma.InputJsonValue },
  });
}

export function metaWebhookDiagnosticsFromConfig(cfg: unknown): {
  webhookSecretConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  lastInboundWebhookAt: string | null;
} {
  const parsed = parseInboxWhatsappFromChannelConfig(cfg);
  const lastInboundWebhookAt =
    cfg && typeof cfg === "object" && !Array.isArray(cfg)
      ? typeof (cfg as Record<string, unknown>).whatsappLastInboundWebhookAt === "string"
        ? ((cfg as Record<string, unknown>).whatsappLastInboundWebhookAt as string)
        : null
      : null;
  return {
    webhookSecretConfigured: Boolean(parsed.whatsappWebhookSecret?.trim()),
    webhookVerifyTokenConfigured: Boolean(parsed.whatsappWebhookVerifyToken?.trim()),
    lastInboundWebhookAt,
  };
}

export function isMetaCloudProviderKind(provider: string | null | undefined): boolean {
  return isMetaCloudWhatsappProvider(provider);
}
