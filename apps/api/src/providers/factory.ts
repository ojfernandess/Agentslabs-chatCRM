import { prisma } from "../db.js";
import { resolveEvolutionApiCredentials } from "../lib/evolutionPlatform.js";
import { WhatsAppProviderInterface } from "./types.js";
import { MetaCloudApiProvider } from "./meta.js";
import { EvolutionApiProvider } from "./evolution.js";

export async function getWhatsAppProvider(organizationId: string): Promise<WhatsAppProviderInterface | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings?.whatsappProvider) {
    return null;
  }

  switch (settings.whatsappProvider) {
    case "meta":
    case "360dialog":
      // 360dialog uses the same Meta Cloud API format with a different base URL
      if (!settings.whatsappApiKey) {
        return null;
      }
      return new MetaCloudApiProvider(
        settings.whatsappApiKey,
        settings.whatsappPhoneNumberId ?? "",
      );
    case "twilio":
      // Twilio provider - to be implemented in v2
      return null;
    case "evolution": {
      const creds = await resolveEvolutionApiCredentials(settings);
      if (!creds) {
        return null;
      }
      return new EvolutionApiProvider(creds.baseUrl, creds.apiKey, creds.instanceName);
    }
    default:
      return null;
  }
}

export async function getWebhookSecret(organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  return settings?.whatsappWebhookSecret ?? null;
}
