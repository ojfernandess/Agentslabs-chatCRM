import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { PageTransition, motion } from "@/components/Motion";
import { UsersRound, Plus } from "lucide-react";
import { TeamOperationalAdmin } from "@/components/teams-hub/TeamOperationalAdmin";

export function TeamsLegacyPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.post("/teams", { name });
      setNewTeamName("");
      setRefreshKey((k) => k + 1);
    } finally {
      setCreating(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-ink-600">{t("common.adminRequired")}</p>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-full">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b border-ink-200/80 bg-white/80 px-6 py-5 backdrop-blur-md dark:border-ink-800 dark:bg-ink-950/80"
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-brand-600">
                <UsersRound className="h-6 w-6" />
                <span className="text-sm font-medium uppercase tracking-wide">{t("nav.teams")}</span>
              </div>
              <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">{t("teams.title")}</h1>
              <p className="mt-1 text-ink-600 dark:text-ink-400">{t("teams.subtitle")}</p>
            </div>
            <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
              <input
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder={t("teams.namePlaceholder")}
                className="input-field min-w-[200px] flex-1"
              />
              <button type="submit" disabled={creating || !newTeamName.trim()} className="btn-primary inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                {t("teams.create")}
              </button>
            </form>
          </div>
        </motion.header>
        <TeamOperationalAdmin key={refreshKey} />
      </div>
    </PageTransition>
  );
}
