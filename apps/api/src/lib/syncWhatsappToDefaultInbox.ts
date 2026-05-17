import type { Prisma } from "@prisma/client";
import { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import {
  assertUniqueWhatsappProviderInOrg,
  prepareWhatsappChannelConfigForSave,
} from "./inboxWhatsappConfig.js";

export type WhatsappInboxChannelPatch = {
  whatsappProvider?: string;
  whatsappPhoneNumberId?: string;
  whatsappApiKey?: string;
  whatsappWebhookSecret?: string;
  whatsappDisplayPhone?: string;
  whatsappBusinessAccountId?: string;
  evolutionApiBaseUrl?: string;
};

/**
 * Espelha credenciais WhatsApp da organização na caixa default (Meta Cloud, Evolution, etc.).
 */
export async function syncWhatsappCredentialsToDefaultInbox(
  organizationId: string,
  patch: WhatsappInboxChannelPatch,
): Promise<{ inboxId: string } | null> {
  if (!patch.whatsappProvider?.trim()) return null;

  const inboxId = await getDefaultInboxId(organizationId);
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    select: { id: true, channelType: true, channelConfig: true },
  });
  if (!inbox) return null;

  const provider = patch.whatsappProvider.trim();
  const unique = await assertUniqueWhatsappProviderInOrg(organizationId, provider, inbox.id);
  if (unique.conflict) {
    throw new Error(
      `A WhatsApp inbox for provider "${provider}" already exists (${unique.existingInboxName}). Configure it under Inboxes.`,
    );
  }

  const incoming: Record<string, unknown> = { whatsappProvider: provider };
  if (patch.whatsappPhoneNumberId !== undefined) {
    incoming.whatsappPhoneNumberId = patch.whatsappPhoneNumberId;
  }
  if (patch.whatsappApiKey !== undefined) {
    incoming.whatsappApiKey = patch.whatsappApiKey;
  }
  if (patch.whatsappWebhookSecret !== undefined) {
    incoming.whatsappWebhookSecret = patch.whatsappWebhookSecret;
  }
  if (patch.whatsappDisplayPhone !== undefined) {
    incoming.whatsappDisplayPhone = patch.whatsappDisplayPhone;
  }
  if (patch.whatsappBusinessAccountId !== undefined) {
    incoming.whatsappBusinessAccountId = patch.whatsappBusinessAccountId;
  }
  if (patch.evolutionApiBaseUrl !== undefined) {
    incoming.evolutionApiBaseUrl = patch.evolutionApiBaseUrl;
  }

  const channelConfig = prepareWhatsappChannelConfigForSave({
    existingConfig: inbox.channelConfig,
    incoming,
    ensureMetaVerifyToken: true,
  });

  await prisma.inbox.update({
    where: { id: inbox.id },
    data: {
      channelType: InboxChannelType.WHATSAPP,
      channelConfig: channelConfig as Prisma.InputJsonValue,
    },
  });

  return { inboxId: inbox.id };
}
