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
    } else if (options.inboxId) {
      const urlInbox = await prisma.inbox.findFirst({
        where: { id: options.inboxId, organizationId },
        select: { id: true, channelConfig: true },
      });
      const urlCreds = urlInbox ? await resolveInboxWhatsappCredentials(organizationId, urlInbox) : null;
      if (urlCreds && isMetaCloudWhatsappProvider(urlCreds.whatsappProvider)) {
        log?.warn(
          { organizationId, phoneNumberId: phoneId, inboxId: options.inboxId },
          "Meta webhook routed via URL inbox — syncing phone_number_id from payload",
        );
        inboxId = options.inboxId;
        void syncInboxPhoneNumberIdFromWebhook(options.inboxId, phoneId).catch(() => {});
      } else {
        log?.warn(
          { organizationId, phoneNumberId: phoneId, urlInboxId: options.inboxId },
          "Meta webhook: phone_number_id not linked to any inbox in this organization",
        );
        return null;
      }
    } else {
      log?.warn(
        { organizationId, phoneNumberId: phoneId },
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

export type WhatsappWebhookAttemptStatus = "received" | "processed" | "rejected";

function inboxChannelConfigBase(cfg: unknown): Record<string, unknown> {
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? { ...(cfg as Record<string, unknown>) } : {};
}

/** Regista qualquer tentativa de POST (mesmo rejeitada) para diagnóstico na inbox. */
export async function recordWhatsappWebhookAttempt(
  inboxId: string,
  status: WhatsappWebhookAttemptStatus,
  error?: string,
): Promise<void> {
  const inbox = await prisma.inbox.findUnique({
    where: { id: inboxId },
    select: { channelConfig: true },
  });
  if (!inbox) return;
  const base = inboxChannelConfigBase(inbox.channelConfig);
  const now = new Date().toISOString();
  base.whatsappLastWebhookAttemptAt = now;
  base.whatsappLastWebhookAttemptStatus = status;
  if (error) {
    base.whatsappLastWebhookAttemptError = error;
  } else {
    delete base.whatsappLastWebhookAttemptError;
  }
  if (status === "processed") {
    base.whatsappLastInboundWebhookAt = now;
  }
  await prisma.inbox.update({
    where: { id: inboxId },
    data: { channelConfig: base as Prisma.InputJsonValue },
  });
}

export async function recordWhatsappInboundWebhook(inboxId: string): Promise<void> {
  await recordWhatsappWebhookAttempt(inboxId, "processed");
}

export async function syncInboxPhoneNumberIdFromWebhook(
  inboxId: string,
  phoneNumberId: string,
): Promise<void> {
  const needle = phoneNumberId.trim();
  if (!needle) return;
  const inbox = await prisma.inbox.findUnique({
    where: { id: inboxId },
    select: { channelConfig: true },
  });
  if (!inbox) return;
  const parsed = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
  if (parsed.whatsappPhoneNumberId?.trim() === needle) return;
  const base = inboxChannelConfigBase(inbox.channelConfig);
  base.whatsappPhoneNumberId = needle;
  await prisma.inbox.update({
    where: { id: inboxId },
    data: { channelConfig: base as Prisma.InputJsonValue },
  });
}

function strFromCfg(cfg: unknown, key: string): string | null {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const v = (cfg as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function metaWebhookDiagnosticsFromConfig(cfg: unknown): {
  webhookSecretConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  lastInboundWebhookAt: string | null;
  lastWebhookAttemptAt: string | null;
  lastWebhookAttemptStatus: WhatsappWebhookAttemptStatus | null;
  lastWebhookAttemptError: string | null;
} {
  const parsed = parseInboxWhatsappFromChannelConfig(cfg);
  const statusRaw = strFromCfg(cfg, "whatsappLastWebhookAttemptStatus");
  const attemptStatus =
    statusRaw === "received" || statusRaw === "processed" || statusRaw === "rejected"
      ? statusRaw
      : null;
  return {
    webhookSecretConfigured: Boolean(parsed.whatsappWebhookSecret?.trim()),
    webhookVerifyTokenConfigured: Boolean(parsed.whatsappWebhookVerifyToken?.trim()),
    lastInboundWebhookAt: strFromCfg(cfg, "whatsappLastInboundWebhookAt"),
    lastWebhookAttemptAt: strFromCfg(cfg, "whatsappLastWebhookAttemptAt"),
    lastWebhookAttemptStatus: attemptStatus,
    lastWebhookAttemptError: strFromCfg(cfg, "whatsappLastWebhookAttemptError"),
  };
}

export function isMetaCloudProviderKind(provider: string | null | undefined): boolean {
  return isMetaCloudWhatsappProvider(provider);
}
