import type { Prisma } from "@prisma/client";
import { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import { newIngestToken } from "./channelInboxIngest.js";
import {
  findWhatsappInboxByProvider,
  parseInboxWhatsappFromChannelConfig,
  prepareWhatsappChannelConfigForSave,
} from "./inboxWhatsappConfig.js";
import type { WhatsappInboxChannelPatch } from "./syncWhatsappToDefaultInbox.js";

export type { WhatsappInboxChannelPatch };

function inboxNameForProvider(provider: string): string {
  switch (provider) {
    case "meta":
      return "WhatsApp Meta Cloud API";
    case "360dialog":
      return "WhatsApp 360dialog";
    case "evolution":
      return "WhatsApp Evolution API";
    case "evolution_go":
      return "WhatsApp Evolution Go";
    case "twilio":
      return "WhatsApp Twilio";
    default:
      return "WhatsApp";
  }
}

async function attachOrgUsersToInbox(organizationId: string, inboxId: string): Promise<void> {
  const users = await prisma.user.findMany({
    where: { organizationId },
    select: { id: true },
  });
  if (users.length === 0) return;
  await prisma.inboxMember.createMany({
    data: users.map((u) => ({ inboxId, userId: u.id })),
    skipDuplicates: true,
  });
}

function patchToIncoming(patch: WhatsappInboxChannelPatch): Record<string, unknown> {
  const incoming: Record<string, unknown> = { whatsappProvider: patch.whatsappProvider };
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
  return incoming;
}

/**
 * Grava credenciais na caixa WhatsApp certa: atualiza inbox do mesmo provider, ou default vazia, ou cria nova caixa.
 */
export async function syncWhatsappCredentialsToInbox(
  organizationId: string,
  patch: WhatsappInboxChannelPatch,
): Promise<{ inboxId: string; created: boolean } | null> {
  if (!patch.whatsappProvider?.trim()) return null;

  const provider = patch.whatsappProvider.trim();
  const incoming = patchToIncoming(patch);

  const existing = await findWhatsappInboxByProvider(organizationId, provider);
  if (existing) {
    const inbox = await prisma.inbox.findFirst({
      where: { id: existing.id, organizationId },
      select: { id: true, channelConfig: true },
    });
    if (!inbox) return null;
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
    return { inboxId: inbox.id, created: false };
  }

  const defaultInboxId = await getDefaultInboxId(organizationId);
  const defaultInbox = await prisma.inbox.findFirst({
    where: { id: defaultInboxId, organizationId },
    select: { id: true, channelConfig: true, channelType: true },
  });
  const defaultParsed = parseInboxWhatsappFromChannelConfig(defaultInbox?.channelConfig);

  if (defaultInbox && !defaultParsed.whatsappProvider) {
    const channelConfig = prepareWhatsappChannelConfigForSave({
      existingConfig: defaultInbox.channelConfig,
      incoming,
      ensureMetaVerifyToken: true,
    });
    await prisma.inbox.update({
      where: { id: defaultInbox.id },
      data: {
        channelType: InboxChannelType.WHATSAPP,
        channelConfig: channelConfig as Prisma.InputJsonValue,
      },
    });
    return { inboxId: defaultInbox.id, created: false };
  }

  const channelConfig = prepareWhatsappChannelConfigForSave({
    existingConfig: null,
    incoming,
    ensureMetaVerifyToken: true,
  });
  const created = await prisma.inbox.create({
    data: {
      organizationId,
      name: inboxNameForProvider(provider),
      channelType: InboxChannelType.WHATSAPP,
      isDefault: false,
      ingestToken: newIngestToken(),
      channelConfig: channelConfig as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await attachOrgUsersToInbox(organizationId, created.id);
  return { inboxId: created.id, created: true };
}

/** Espelha credenciais da caixa WhatsApp em Settings (UI da organização). */
export async function syncWhatsappInboxCredentialsToSettings(
  organizationId: string,
  inboxId: string,
): Promise<void> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { channelConfig: true },
  });
  if (!inbox) return;

  const parsed = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
  if (!parsed.whatsappProvider) return;

  const data: Prisma.SettingsUpdateInput = {
    whatsappProvider: parsed.whatsappProvider,
    whatsappPhoneNumberId: parsed.whatsappPhoneNumberId ?? null,
    whatsappApiKey: parsed.whatsappApiKey ?? null,
    whatsappWebhookSecret: parsed.whatsappWebhookSecret ?? null,
    evolutionApiBaseUrl: parsed.evolutionApiBaseUrl ?? null,
    whatsappWebhookVerifyToken: parsed.whatsappWebhookVerifyToken ?? undefined,
  };

  await prisma.settings.upsert({
    where: { organizationId },
    create: {
      organization: { connect: { id: organizationId } },
      whatsappProvider: parsed.whatsappProvider,
      whatsappPhoneNumberId: parsed.whatsappPhoneNumberId ?? null,
      whatsappApiKey: parsed.whatsappApiKey ?? null,
      whatsappWebhookSecret: parsed.whatsappWebhookSecret ?? null,
      evolutionApiBaseUrl: parsed.evolutionApiBaseUrl ?? null,
      ...(parsed.whatsappWebhookVerifyToken
        ? { whatsappWebhookVerifyToken: parsed.whatsappWebhookVerifyToken }
        : {}),
    },
    update: data,
  });
}
