import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type TurnstilePublicConfig = {
  enabled: boolean;
  siteKey: string | null;
};

let cachedConfig: TurnstilePublicConfig | null = null;
let inflight: Promise<TurnstilePublicConfig> | null = null;

function loadTurnstileConfig(): Promise<TurnstilePublicConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (inflight) return inflight;
  inflight = api
    .get<TurnstilePublicConfig>("/public/turnstile-config")
    .then((data) => {
      cachedConfig = data;
      return data;
    })
    .catch(() => {
      const fallback = { enabled: false, siteKey: null };
      cachedConfig = fallback;
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useTurnstileConfig() {
  const [config, setConfig] = useState<TurnstilePublicConfig | null>(cachedConfig);
  const [loading, setLoading] = useState(!cachedConfig);

  useEffect(() => {
    let cancelled = false;
    void loadTurnstileConfig().then((data) => {
      if (!cancelled) setConfig(data);
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loading, turnstileActive: Boolean(config?.enabled && config.siteKey) };
}

export function invalidateTurnstileConfigCache() {
  cachedConfig = null;
}
