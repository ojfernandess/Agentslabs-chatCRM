import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export const ORG_BRANDING_UPDATED_EVENT = "openconduit:org-branding-updated";

const LOGO_CACHE_PREFIX = "openconduit:org-logo:";

type OrganizationBranding = {
  organizationLogoUrl: string | null;
};

function logoCacheKey(organizationKey: string | null | undefined): string | null {
  if (!organizationKey) return null;
  return `${LOGO_CACHE_PREFIX}${organizationKey}`;
}

/** undefined = sem cache; null = logo do sistema; string = URL personalizada */
function readLogoCache(organizationKey: string | null | undefined): string | null | undefined {
  const key = logoCacheKey(organizationKey);
  if (!key) return undefined;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return undefined;
    return raw === "" ? null : raw;
  } catch {
    return undefined;
  }
}

function writeLogoCache(organizationKey: string | null | undefined, url: string | null): void {
  const key = logoCacheKey(organizationKey);
  if (!key) return;
  try {
    sessionStorage.setItem(key, url ?? "");
  } catch {
    /* ignore */
  }
}

export function notifyOrganizationBrandingUpdated(): void {
  window.dispatchEvent(new CustomEvent(ORG_BRANDING_UPDATED_EVENT));
}

export function useOrganizationBranding(enabled: boolean, organizationKey?: string | null) {
  const cached = readLogoCache(organizationKey);
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState<string | null>(
    cached === undefined ? null : cached,
  );
  const [brandingReady, setBrandingReady] = useState(!enabled || cached !== undefined);

  const reload = useCallback(async () => {
    if (!enabled) {
      setOrganizationLogoUrl(null);
      setBrandingReady(true);
      return;
    }

    const snapshot = readLogoCache(organizationKey);
    if (snapshot === undefined) {
      setBrandingReady(false);
    }

    try {
      const data = await api.get<OrganizationBranding>("/settings/branding");
      const url = data.organizationLogoUrl ?? null;
      setOrganizationLogoUrl(url);
      writeLogoCache(organizationKey, url);
    } catch {
      setOrganizationLogoUrl(null);
      writeLogoCache(organizationKey, null);
    } finally {
      setBrandingReady(true);
    }
  }, [enabled, organizationKey]);

  useEffect(() => {
    const snapshot = readLogoCache(organizationKey);
    setOrganizationLogoUrl(snapshot === undefined ? null : snapshot);
    setBrandingReady(!enabled || snapshot !== undefined);
    void reload();
  }, [reload, organizationKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onUpdated = () => {
      void reload();
    };
    window.addEventListener(ORG_BRANDING_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(ORG_BRANDING_UPDATED_EVENT, onUpdated);
  }, [enabled, reload]);

  return { organizationLogoUrl, brandingReady, reload };
}
