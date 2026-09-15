import { prisma } from "../db.js";

export const HELP_CENTER_PLATFORM_KEY = "help_center_config";

export type HelpCenterConfig = {
  support: {
    enabled: boolean;
    phone: string;
    whatsappMessage: string;
    title: string;
    description: string;
  };
  guide: {
    enabled: boolean;
    title: string;
    description: string;
  };
};

export const DEFAULT_HELP_CENTER_CONFIG: HelpCenterConfig = {
  support: {
    enabled: true,
    phone: "",
    whatsappMessage: "Olá! Sou cliente e preciso de ajuda com a plataforma.",
    title: "Falar com o Suporte",
    description:
      "Nosso time de suporte vai te ajudar com qualquer problema ou dúvida na plataforma.",
  },
  guide: {
    enabled: true,
    title: "Central de Ajuda",
    description: "Aprenda a configurar e aproveitar todos os recursos da plataforma.",
  },
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function readString(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : fallback;
}

function readBool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

export function parseHelpCenterConfig(raw: unknown): HelpCenterConfig {
  const root = asRecord(raw);
  if (!root) return { ...DEFAULT_HELP_CENTER_CONFIG };

  const supportRaw = asRecord(root.support);
  const guideRaw = asRecord(root.guide);

  return {
    support: {
      enabled: supportRaw ? readBool(supportRaw, "enabled", DEFAULT_HELP_CENTER_CONFIG.support.enabled) : DEFAULT_HELP_CENTER_CONFIG.support.enabled,
      phone: supportRaw ? readString(supportRaw, "phone", "") : "",
      whatsappMessage: supportRaw
        ? readString(supportRaw, "whatsappMessage", DEFAULT_HELP_CENTER_CONFIG.support.whatsappMessage)
        : DEFAULT_HELP_CENTER_CONFIG.support.whatsappMessage,
      title: supportRaw
        ? readString(supportRaw, "title", DEFAULT_HELP_CENTER_CONFIG.support.title)
        : DEFAULT_HELP_CENTER_CONFIG.support.title,
      description: supportRaw
        ? readString(supportRaw, "description", DEFAULT_HELP_CENTER_CONFIG.support.description)
        : DEFAULT_HELP_CENTER_CONFIG.support.description,
    },
    guide: {
      enabled: guideRaw ? readBool(guideRaw, "enabled", DEFAULT_HELP_CENTER_CONFIG.guide.enabled) : DEFAULT_HELP_CENTER_CONFIG.guide.enabled,
      title: guideRaw ? readString(guideRaw, "title", DEFAULT_HELP_CENTER_CONFIG.guide.title) : DEFAULT_HELP_CENTER_CONFIG.guide.title,
      description: guideRaw
        ? readString(guideRaw, "description", DEFAULT_HELP_CENTER_CONFIG.guide.description)
        : DEFAULT_HELP_CENTER_CONFIG.guide.description,
    },
  };
}

/** Digits-only phone for wa.me links (no + prefix). */
export function normalizeWhatsAppPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const digits = normalizeWhatsAppPhone(phone);
  if (!digits) return null;
  const encoded = encodeURIComponent(message.trim());
  return `https://wa.me/${digits}${encoded ? `?text=${encoded}` : ""}`;
}

export async function getHelpCenterConfig(): Promise<HelpCenterConfig> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: HELP_CENTER_PLATFORM_KEY },
    select: { value: true },
  });
  if (!row) return { ...DEFAULT_HELP_CENTER_CONFIG };
  return parseHelpCenterConfig(row.value);
}

/** Public-facing config for authenticated tenants (no raw phone storage in bundle). */
export type HelpCenterPublicConfig = {
  support: {
    enabled: boolean;
    title: string;
    description: string;
    whatsappMessage: string;
    whatsappUrl: string | null;
    phoneDisplay: string;
  };
  guide: {
    enabled: boolean;
    title: string;
    description: string;
  };
};

export function toPublicHelpCenterConfig(config: HelpCenterConfig): HelpCenterPublicConfig {
  const phone = config.support.phone.trim();
  const message = config.support.whatsappMessage.trim();
  return {
    support: {
      enabled: config.support.enabled,
      title: config.support.title,
      description: config.support.description,
      whatsappMessage: message,
      whatsappUrl: config.support.enabled ? buildWhatsAppUrl(phone, message) : null,
      phoneDisplay: phone,
    },
    guide: {
      enabled: config.guide.enabled,
      title: config.guide.title,
      description: config.guide.description,
    },
  };
}
