import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type IncomingQueueMode = "all" | "assignee" | "team";

type Props = {
  deviceId: string;
  initialMode: IncomingQueueMode;
  initialTeamId: string | null;
  initialAssignedUserId: string | null;
  users: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  onSaved: () => void;
};

export function WavoipIncomingQueuePanel({
  deviceId,
  initialMode,
  initialTeamId,
  initialAssignedUserId,
  users,
  teams,
  onSaved,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<IncomingQueueMode>(initialMode);
  const [teamId, setTeamId] = useState(initialTeamId ?? "");
  const [assignedUserId, setAssignedUserId] = useState(initialAssignedUserId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/settings/wavoip/devices/${deviceId}`, {
        incomingQueue: {
          mode,
          teamId: mode === "team" ? teamId || null : null,
        },
        ...(mode === "assignee" ? { assignedUserId: assignedUserId || null } : {}),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("wavoip.incomingQueue.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-4 dark:border-ink-800 dark:bg-ink-950/50">
      <p className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("wavoip.incomingQueue.title")}</p>
      <p className="mt-1 text-xs text-slate-600 dark:text-ink-400">{t("wavoip.incomingQueue.subtitle")}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium text-slate-700 dark:text-ink-300">{t("wavoip.incomingQueue.mode")}</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as IncomingQueueMode)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
          >
            <option value="all">{t("wavoip.incomingQueue.modeAll")}</option>
            <option value="assignee">{t("wavoip.incomingQueue.modeAssignee")}</option>
            <option value="team">{t("wavoip.incomingQueue.modeTeam")}</option>
          </select>
        </label>

        {mode === "assignee" && (
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700 dark:text-ink-300">
              {t("wavoip.incomingQueue.assignee")}
            </span>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
            >
              <option value="">{t("wavoip.incomingQueue.assigneeNone")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "team" && (
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-700 dark:text-ink-300">{t("wavoip.incomingQueue.team")}</span>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
            >
              <option value="">{t("wavoip.incomingQueue.teamNone")}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="button"
        disabled={saving || (mode === "team" && !teamId) || (mode === "assignee" && !assignedUserId)}
        onClick={() => void save()}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {t("wavoip.incomingQueue.save")}
      </button>
    </div>
  );
}
