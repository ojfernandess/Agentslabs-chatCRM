import { prisma } from "../db.js";
import { decrypt } from "../lib/encryption.js";
import { resolveEvolutionApiCredentials } from "../lib/evolutionPlatform.js";
import { resolveEvolutionGoCredentials } from "../lib/evolutionGoPlatform.js";
import {
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
  type InboxWhatsappCredentialSource,
} from "../lib/inboxWhatsappConfig.js";
import { WhatsAppProviderInterface } from "./types.js";
import { MetaCloudApiProvider } from "./meta.js";
import { EvolutionApiProvider } from "./evolution.js";
import { EvolutionGoProvider } from "./evolutionGo.js";

async function buildProviderFromCredentials(
  creds: InboxWhatsappCredentialSource,
): Promise<WhatsAppProviderInterface | null> {
  switch (creds.whatsappProvider) {
    case "meta":
    case "360dialog":
      if (!creds.whatsappApiKey) return null;
      return new MetaCloudApiProvider(
        decrypt(creds.whatsappApiKey) ?? "",
        creds.whatsappPhoneNumberId ?? "",
        creds.whatsappWebhookVerifyToken ?? null,
      );
    case "twilio":
      return null;
    case "evolution": {
      const resolved = await resolveEvolutionApiCredentials(creds);
      if (!resolved) return null;
      return new EvolutionApiProvider(resolved.baseUrl, resolved.apiKey, resolved.instanceName);
    }
    case "evolution_go": {
      const resolved = await resolveEvolutionGoCredentials(creds);
      if (!resolved) return null;
      return new EvolutionGoProvider(resolved.baseUrl, resolved.apiKey, resolved.instanceId);
    }
    default:
      return null;
  }
}

/** @deprecated Prefer `getWhatsAppProviderForInbox` — legado: credenciais só em Settings. */
export async function getWhatsAppProvider(organizationId: string): Promise<WhatsAppProviderInterface | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings?.whatsappProvider) {
    return null;
  }
  return await buildProviderFromCredentials({
    whatsappProvider: settings.whatsappProvider,
    whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
    whatsappApiKey: settings.whatsappApiKey,
    whatsappWebhookSecret: settings.whatsappWebhookSecret,
    whatsappWebhookVerifyToken: settings.whatsappWebhookVerifyToken ?? null,
    evolutionApiBaseUrl: settings.evolutionApiBaseUrl,
  });
}

/** Testa credenciais a partir de `channelConfig` (rascunho ou gravado), sem fallback a Settings. */
export async function getWhatsAppProviderFromChannelConfig(
  channelConfig: unknown,
): Promise<WhatsAppProviderInterface | null> {
  const parsed = parseInboxWhatsappFromChannelConfig(channelConfig);
  if (!parsed.whatsappProvider) return null;
  return await buildProviderFromCredentials({
    whatsappProvider: parsed.whatsappProvider,
    whatsappPhoneNumberId: parsed.whatsappPhoneNumberId ?? null,
    whatsappApiKey: parsed.whatsappApiKey ?? null,
    whatsappWebhookSecret: parsed.whatsappWebhookSecret ?? null,
    whatsappWebhookVerifyToken: parsed.whatsappWebhookVerifyToken ?? null,
    evolutionApiBaseUrl: parsed.evolutionApiBaseUrl ?? null,
  });
}

export async function getWhatsAppProviderForInbox(
  organizationId: string,
  inboxId: string,
): Promise<WhatsAppProviderInterface | null> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    select: { channelConfig: true },
  });
  if (!inbox) return getWhatsAppProvider(organizationId);

  const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
  if (!creds) return null;
  return await buildProviderFromCredentials(creds);
}

export async function getWhatsappProviderKindForInbox(
  organizationId: string,
  inboxId: string,
): Promise<string | null> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    select: { channelConfig: true },
  });
  if (!inbox) return null;
  const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
  return creds?.whatsappProvider ?? null;
}

export async function getWebhookSecret(organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  return decrypt(settings?.whatsappWebhookSecret) ?? null;
}

export async function getWebhookSecretForInbox(
  organizationId: string,
  inboxId: string,
): Promise<string | null> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId },
    select: { channelConfig: true },
  });
  if (!inbox) return getWebhookSecret(organizationId);

  const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
  if (creds?.whatsappWebhookSecret) {
    return decrypt(creds.whatsappWebhookSecret) ?? null;
  }
  return getWebhookSecret(organizationId);
}
