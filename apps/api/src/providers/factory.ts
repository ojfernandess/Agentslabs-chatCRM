import { prisma } from "../db.js";
import { WhatsAppProviderInterface } from "./types.js";
import { MetaCloudApiProvider } from "./meta.js";
import { EvolutionApiProvider } from "./evolution.js";

export async function getWhatsAppProvider(organizationId: string): Promise<WhatsAppProviderInterface | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings?.whatsappProvider || !settings.whatsappApiKey) {
    return null;
  }

  switch (settings.whatsappProvider) {
    case "meta":
      return new MetaCloudApiProvider(
        settings.whatsappApiKey,
        settings.whatsappPhoneNumberId ?? "",
      );
    case "360dialog":
      // 360dialog uses the same Meta Cloud API format with a different base URL
      // For v1 we use Meta as the default implementation
      return new MetaCloudApiProvider(
        settings.whatsappApiKey,
        settings.whatsappPhoneNumberId ?? "",
      );
    case "twilio":
      // Twilio provider - to be implemented in v2
      return null;
    case "evolution": {
      const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
      const instance = settings.whatsappPhoneNumberId?.trim() ?? "";
      if (!baseUrl || !instance || !settings.whatsappApiKey) {
        return null;
      }
      return new EvolutionApiProvider(baseUrl, settings.whatsappApiKey, instance);
    }
    default:
      return null;
  }
}

export async function getWebhookSecret(organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  return settings?.whatsappWebhookSecret ?? null;
}
