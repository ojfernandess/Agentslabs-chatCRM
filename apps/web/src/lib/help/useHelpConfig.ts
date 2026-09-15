import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

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

const DEFAULT_CONFIG: HelpCenterPublicConfig = {
  support: {
    enabled: true,
    title: "Falar com o Suporte",
    description: "Nosso time de suporte vai te ajudar com qualquer problema ou dúvida na plataforma.",
    whatsappMessage: "Olá! Sou cliente e preciso de ajuda com a plataforma.",
    whatsappUrl: null,
    phoneDisplay: "",
  },
  guide: {
    enabled: true,
    title: "Central de Ajuda",
    description: "Aprenda a configurar e aproveitar todos os recursos da plataforma.",
  },
};

let cachedConfig: HelpCenterPublicConfig | null = null;
let fetchPromise: Promise<HelpCenterPublicConfig> | null = null;

export async function fetchHelpConfig(): Promise<HelpCenterPublicConfig> {
  if (cachedConfig) return cachedConfig;
  if (fetchPromise) return fetchPromise;
  fetchPromise = api
    .get<HelpCenterPublicConfig>("/help-center/config")
    .then((data) => {
      cachedConfig = data;
      return data;
    })
    .catch(() => DEFAULT_CONFIG)
    .finally(() => {
      fetchPromise = null;
    });
  return fetchPromise;
}

export function invalidateHelpConfigCache() {
  cachedConfig = null;
}

export function buildSupportMessage(baseMessage: string, context?: string): string {
  const trimmed = baseMessage.trim();
  if (!context?.trim()) return trimmed;
  return `${trimmed}\n\nEstou consultando: ${context.trim()}`;
}

export function buildWhatsAppUrlFromPhone(phoneDisplay: string, message: string): string | null {
  const digits = phoneDisplay.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message.trim())}`;
}

export function useHelpConfig() {
  const [config, setConfig] = useState<HelpCenterPublicConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    invalidateHelpConfigCache();
    setLoading(true);
    try {
      const data = await fetchHelpConfig();
      setConfig(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchHelpConfig().then((data) => {
      if (!cancelled) {
        setConfig(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loading, reload };
}
