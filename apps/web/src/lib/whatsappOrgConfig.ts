export const MASKED_WHATSAPP_SECRET = "••••••••";

/** Estado das credenciais WhatsApp ao nível da organização (`Settings`, legado). */
export type WhatsappOrgSettingsSnapshot = {
  whatsappProvider: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappApiKey: string | null;
};

export function isOrgWhatsappConfigured(settings: WhatsappOrgSettingsSnapshot | null | undefined): boolean {
  if (!settings?.whatsappProvider?.trim()) return false;
  const p = settings.whatsappProvider;
  const hasInstance = Boolean(settings.whatsappPhoneNumberId?.trim());
  if (p === "meta" || p === "360dialog") {
    return hasInstance && settings.whatsappApiKey === "••••••••";
  }
  if (p === "twilio") {
    return hasInstance && settings.whatsappApiKey === "••••••••";
  }
  return hasInstance;
}

export function whatsappProviderLabel(provider: string | null | undefined): string {
  switch (provider) {
    case "meta":
      return "Meta Cloud API";
    case "360dialog":
      return "360dialog";
    case "twilio":
      return "Twilio";
    case "evolution":
      return "Evolution API";
    case "evolution_go":
      return "Evolution Go";
    default:
      return provider ?? "—";
  }
}
