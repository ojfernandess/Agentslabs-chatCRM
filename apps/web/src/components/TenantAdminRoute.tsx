import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition } from "@/components/Motion";

/** Redirects non–tenant-admins away from org-admin screens (settings, bots, broadcasts, …). */
export function TenantAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  const allowed = isTenantAdmin(user?.role, user?.actingOrganizationId);
  if (!allowed) {
    return (
      <PageTransition>
        <div className="flex h-full min-h-[40vh] items-center justify-center p-8">
          <p className="text-center text-ink-500 dark:text-ink-400">{t("common.adminRequired")}</p>
        </div>
      </PageTransition>
    );
  }

  return <>{children}</>;
}
