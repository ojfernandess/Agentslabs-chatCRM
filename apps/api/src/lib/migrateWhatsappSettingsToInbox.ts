import type { Prisma } from "@prisma/client";
import { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import {
  parseInboxWhatsappFromChannelConfig,
  prepareWhatsappChannelConfigForSave,
} from "./inboxWhatsappConfig.js";

/**
 * Copia credenciais WhatsApp legadas de `Settings` para a caixa WhatsApp default
 * quando a caixa ainda não tem `whatsappProvider` em `channelConfig`.
 */
export async function migrateWhatsappSettingsToDefaultInbox(organizationId: string): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: {
      whatsappProvider: true,
      whatsappPhoneNumberId: true,
      whatsappApiKey: true,
      whatsappWebhookSecret: true,
      whatsappWebhookVerifyToken: true,
      evolutionApiBaseUrl: true,
    },
  });
  if (!settings?.whatsappProvider?.trim()) return false;

  const defaultInboxId = await getDefaultInboxId(organizationId);
  const inbox = await prisma.inbox.findFirst({
    where: { id: defaultInboxId, organizationId },
    select: { id: true, channelType: true, channelConfig: true },
  });
  if (!inbox) return false;

  const existing = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
  if (existing.whatsappProvider) return false;

  const channelConfig = prepareWhatsappChannelConfigForSave({
    existingConfig: inbox.channelConfig,
    incoming: {
      whatsappProvider: settings.whatsappProvider,
      whatsappPhoneNumberId: settings.whatsappPhoneNumberId ?? undefined,
      whatsappApiKey: settings.whatsappApiKey ?? undefined,
      whatsappWebhookSecret: settings.whatsappWebhookSecret ?? undefined,
      whatsappWebhookVerifyToken: settings.whatsappWebhookVerifyToken ?? undefined,
      evolutionApiBaseUrl: settings.evolutionApiBaseUrl ?? undefined,
    },
    ensureMetaVerifyToken: false,
  });

  await prisma.inbox.update({
    where: { id: inbox.id },
    data: {
      channelType: InboxChannelType.WHATSAPP,
      channelConfig: channelConfig as Prisma.InputJsonValue,
    },
  });
  return true;
}
