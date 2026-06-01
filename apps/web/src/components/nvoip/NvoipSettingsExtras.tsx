import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type LogRow = {
  id: string;
  level: string;
  eventType: string;
  message: string;
  createdAt: string;
};

type DidRow = { number: string; destination: string | null; label: string | null };

type TeamOption = { id: string; name: string };

export function NvoipSettingsExtras({
  voiceEnabled,
  linked,
  incomingQueueMode,
  incomingQueueTeamId,
  lowBalanceAlertBrl,
  onRoutingChange,
  dids,
  onDidsReload,
}: {
  voiceEnabled: boolean;
  linked: boolean;
  incomingQueueMode: "all" | "team";
  incomingQueueTeamId: string;
  lowBalanceAlertBrl: string;
  onRoutingChange: (patch: {
    incomingQueueMode?: "all" | "team";
    incomingQueueTeamId?: string;
    lowBalanceAlertBrl?: string;
  }) => void;
  dids: DidRow[];
  onDidsReload: () => void;
}) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [scheduled, setScheduled] = useState<{ data: Record<string, unknown>[]; local: unknown[] } | null>(
    null,
  );
  const [schedLoading, setSchedLoading] = useState(false);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [didEdit, setDidEdit] = useState({ number: "", destination: "" });
  const [didSaving, setDidSaving] = useState(false);
  const [schedForm, setSchedForm] = useState({
    phone: "",
    message: "",
    scheduledAt: "",
  });
  const [schedSending, setSchedSending] = useState(false);
  const [sipForm, setSipForm] = useState({ name: "", caller: "" });
  const [sipCreating, setSipCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await api.get<{ data: LogRow[] }>("/settings/nvoip/logs");
      setLogs(res.data ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const loadScheduled = useCallback(async () => {
    setSchedLoading(true);
    try {
      const res = await api.get<{ data: Record<string, unknown>[]; local: unknown[] }>(
        "/settings/nvoip/torpedos/scheduled",
      );
      setScheduled(res);
    } catch {
      setScheduled({ data: [], local: [] });
    } finally {
      setSchedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!voiceEnabled || !linked) return;
    void loadLogs();
    void loadScheduled();
    void api
      .get<{ data: TeamOption[] }>("/settings/nvoip/teams")
      .then((r) => setTeams(r.data ?? []))
      .catch(() => setTeams([]));
  }, [voiceEnabled, linked, loadLogs, loadScheduled]);

  if (!voiceEnabled) return null;

  const schedkeyFrom = (row: Record<string, unknown>) => {
    const k = row.schedkey ?? row.schedKey ?? row.key;
    return typeof k === "string" ? k : "";
  };

  return (
    <div className="mt-8 space-y-6">
      <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("nvoip.routing.title")}</h3>
        <p className="mt-1 text-xs text-slate-500">{t("nvoip.routing.hint")}</p>
        <label className="mt-3 block text-sm">
          <span className="font-medium">{t("nvoip.routing.mode")}</span>
          <select
            value={incomingQueueMode}
            onChange={(e) =>
              onRoutingChange({ incomingQueueMode: e.target.value as "all" | "team" })
            }
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
          >
            <option value="all">{t("nvoip.routing.modeAll")}</option>
            <option value="team">{t("nvoip.routing.modeTeam")}</option>
          </select>
        </label>
        {incomingQueueMode === "team" ? (
          <label className="mt-3 block text-sm">
            <span className="font-medium">{t("nvoip.routing.team")}</span>
            <select
              value={incomingQueueTeamId}
              onChange={(e) => onRoutingChange({ incomingQueueTeamId: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
            >
              <option value="">{t("nvoip.routing.teamPlaceholder")}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="mt-3 block text-sm">
          <span className="font-medium">{t("nvoip.routing.balanceAlert")}</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={lowBalanceAlertBrl}
            onChange={(e) => onRoutingChange({ lowBalanceAlertBrl: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
          />
        </label>
      </div>

      {linked ? (
        <>
          <div className="max-w-2xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("nvoip.logs.title")}</h3>
              <button type="button" className="text-xs font-medium text-brand-600" onClick={() => void loadLogs()}>
                {t("nvoip.insights.refresh")}
              </button>
            </div>
            {logsLoading ? (
              <p className="mt-2 text-sm text-slate-500">{t("common.loading")}</p>
            ) : logs.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t("nvoip.logs.empty")}</p>
            ) : (
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
                {logs.map((log) => (
                  <li key={log.id} className="border-b border-slate-100 py-1 dark:border-ink-800">
                    <span className="text-slate-400">{log.createdAt}</span> [{log.level}] {log.eventType}:{" "}
                    {log.message.slice(0, 160)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
            <h3 className="text-sm font-semibold">{t("nvoip.scheduled.title")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("nvoip.scheduled.hint")}</p>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-3 grid gap-2">
              <input
                placeholder={t("nvoip.torpedoPhone")}
                value={schedForm.phone}
                onChange={(e) => setSchedForm((s) => ({ ...s, phone: e.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <textarea
                rows={2}
                placeholder={t("nvoip.torpedoMessage")}
                value={schedForm.message}
                onChange={(e) => setSchedForm((s) => ({ ...s, message: e.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <input
                type="datetime-local"
                value={schedForm.scheduledAt}
                onChange={(e) => setSchedForm((s) => ({ ...s, scheduledAt: e.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={schedSending}
                onClick={() => {
                  setSchedSending(true);
                  setError(null);
                  void api
                    .post("/settings/nvoip/torpedos/schedule", {
                      phone: schedForm.phone.trim(),
                      message: schedForm.message.trim(),
                      scheduledAt: new Date(schedForm.scheduledAt).toISOString(),
                    })
                    .then(() => {
                      setSchedForm({ phone: "", message: "", scheduledAt: "" });
                      void loadScheduled();
                    })
                    .catch((e) =>
                      setError(e instanceof ApiError ? e.message : t("nvoip.scheduled.scheduleError")),
                    )
                    .finally(() => setSchedSending(false));
                }}
              >
                {schedSending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.scheduled.schedule")}
              </button>
            </div>
            <button
              type="button"
              className="mt-3 text-xs text-brand-600"
              onClick={() => void loadScheduled()}
            >
              {schedLoading ? t("common.loading") : t("nvoip.scheduled.refresh")}
            </button>
            {(scheduled?.data?.length ?? 0) > 0 ? (
              <ul className="mt-3 space-y-2 text-xs">
                {scheduled!.data.map((row, i) => {
                  const key = schedkeyFrom(row) || `row-${i}`;
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1 dark:border-ink-800"
                    >
                      <span className="font-mono truncate">{key}</span>
                      <button
                        type="button"
                        className="text-red-600"
                        title={t("nvoip.scheduled.cancel")}
                        onClick={() =>
                          void api
                            .delete(`/settings/nvoip/torpedos/scheduled/${encodeURIComponent(key)}`)
                            .then(() => void loadScheduled())
                            .catch((e) =>
                              setError(
                                e instanceof ApiError ? e.message : t("nvoip.scheduled.cancelError"),
                              ),
                            )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">{t("nvoip.scheduled.empty")}</p>
            )}
          </div>

          <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
            <h3 className="text-sm font-semibold">{t("nvoip.sipCreate.title")}</h3>
            <p className="mt-1 text-xs text-slate-500">{t("nvoip.sipCreate.hint")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                placeholder={t("nvoip.sipUsersColName")}
                value={sipForm.name}
                onChange={(e) => setSipForm((s) => ({ ...s, name: e.target.value }))}
                className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <input
                placeholder={t("nvoip.sipUsersColCaller")}
                value={sipForm.caller}
                onChange={(e) => setSipForm((s) => ({ ...s, caller: e.target.value }))}
                className="min-w-[80px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={sipCreating}
                onClick={() => {
                  setSipCreating(true);
                  void api
                    .post("/settings/nvoip/users", sipForm)
                    .then(() => setSipForm({ name: "", caller: "" }))
                    .catch((e) =>
                      setError(e instanceof ApiError ? e.message : t("nvoip.sipCreate.error")),
                    )
                    .finally(() => setSipCreating(false));
                }}
              >
                {sipCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.sipCreate.submit")}
              </button>
            </div>
          </div>

          {dids.length > 0 ? (
            <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <h3 className="text-sm font-semibold">{t("nvoip.didEdit.title")}</h3>
              <p className="mt-1 text-xs text-slate-500">{t("nvoip.didEdit.hint")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  value={didEdit.number}
                  onChange={(e) => {
                    const num = e.target.value;
                    const row = dids.find((d) => d.number === num);
                    setDidEdit({
                      number: num,
                      destination: row?.destination ?? "",
                    });
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
                >
                  <option value="">{t("nvoip.didEdit.pick")}</option>
                  {dids.map((d) => (
                    <option key={d.number} value={d.number}>
                      {d.number}
                    </option>
                  ))}
                </select>
                <input
                  value={didEdit.destination}
                  onChange={(e) => setDidEdit((s) => ({ ...s, destination: e.target.value }))}
                  placeholder={t("nvoip.didsColDestination")}
                  className="min-w-[140px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
                />
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  disabled={didSaving || !didEdit.number}
                  onClick={() => {
                    setDidSaving(true);
                    void api
                      .put("/settings/nvoip/dids", didEdit)
                      .then(() => onDidsReload())
                      .catch((e) =>
                        setError(e instanceof ApiError ? e.message : t("nvoip.didEdit.error")),
                      )
                      .finally(() => setDidSaving(false));
                  }}
                >
                  {didSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.didEdit.save")}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
