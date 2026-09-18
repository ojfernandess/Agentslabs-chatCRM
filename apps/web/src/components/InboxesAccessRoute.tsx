import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition } from "@/components/Motion";

/** Tenant admins always; agents only when org enables «Caixas de entrada» for agents. */
export function InboxesAccessRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [agentsInboxesVisible, setAgentsInboxesVisible] = useState<boolean | null>(null);

  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  useEffect(() => {
    if (loading || !user) return;
    if (tenantAdmin) {
      setAgentsInboxesVisible(true);
      return;
    }
    if (user.role !== "AGENT") {
      setAgentsInboxesVisible(false);
      return;
    }
    let cancelled = false;
    const load = () => {
      void api
        .get<{ agentsInboxesVisible?: boolean }>("/settings/channel")
        .then((res) => {
          if (!cancelled) setAgentsInboxesVisible(res.agentsInboxesVisible === true);
        })
        .catch(() => {
          if (!cancelled) setAgentsInboxesVisible(false);
        });
    };
    load();
    const onSettingsChanged = () => load();
    window.addEventListener("openconduit:channel-settings-changed", onSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("openconduit:channel-settings-changed", onSettingsChanged);
    };
  }, [loading, tenantAdmin, user?.id, user?.role, user?.actingOrganizationId]);

  if (loading || agentsInboxesVisible === null) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (tenantAdmin || agentsInboxesVisible) {
    return <>{children}</>;
  }

  if (user?.role === "AGENT") {
    return <Navigate to="/conversations" replace />;
  }

  return (
    <PageTransition>
      <div className="flex h-full min-h-[40vh] items-center justify-center p-8">
        <p className="text-center text-ink-500 dark:text-ink-400">{t("common.adminRequired")}</p>
      </div>
    </PageTransition>
  );
}
