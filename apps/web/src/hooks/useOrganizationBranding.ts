import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export const ORG_BRANDING_UPDATED_EVENT = "openconduit:org-branding-updated";

type OrganizationBranding = {
  organizationLogoUrl: string | null;
};

export function notifyOrganizationBrandingUpdated(): void {
  window.dispatchEvent(new CustomEvent(ORG_BRANDING_UPDATED_EVENT));
}

export function useOrganizationBranding(enabled: boolean, organizationKey?: string | null) {
  const [organizationLogoUrl, setOrganizationLogoUrl] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setOrganizationLogoUrl(null);
      return;
    }
    try {
      const data = await api.get<OrganizationBranding>("/settings/branding");
      setOrganizationLogoUrl(data.organizationLogoUrl ?? null);
    } catch {
      setOrganizationLogoUrl(null);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload, organizationKey]);

  useEffect(() => {
    if (!enabled) return;
    const onUpdated = () => {
      void reload();
    };
    window.addEventListener(ORG_BRANDING_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(ORG_BRANDING_UPDATED_EVENT, onUpdated);
  }, [enabled, reload]);

  return { organizationLogoUrl, reload };
}
