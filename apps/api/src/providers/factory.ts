import { prisma } from "../db.js";
import { decrypt } from "../lib/encryption.js";
import { resolveEvolutionApiCredentials } from "../lib/evolutionPlatform.js";
import { WhatsAppProviderInterface } from "./types.js";
import { MetaCloudApiProvider } from "./meta.js";
import { EvolutionApiProvider } from "./evolution.js";
import { EvolutionGoProvider } from "./evolutionGo.js";

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
        decrypt(settings.whatsappApiKey) ?? "",
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
    case "evolution_go": {
      const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
      const apiKey = decrypt(settings.whatsappApiKey) ?? "";
      const instanceId = settings.whatsappPhoneNumberId?.trim() ?? "";
      if (!baseUrl || !apiKey || !instanceId) return null;
      return new EvolutionGoProvider(baseUrl, apiKey, instanceId);
    }
    default:
      return null;
  }
}

export async function getWebhookSecret(organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  return decrypt(settings?.whatsappWebhookSecret) ?? null;
}
