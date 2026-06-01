import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type TrunkRow = { id: string; name: string; defaultCaller: string; isDefault: boolean };

type HomologationCheck = {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn" | "manual";
  message: string;
};

type HomologationResult = {
  ranAt: string;
  checks: HomologationCheck[];
  summary: { pass: number; fail: number; warn: number; manual: number };
};

const statusClass: Record<HomologationCheck["status"], string> = {
  pass: "text-emerald-700 bg-emerald-50",
  fail: "text-red-700 bg-red-50",
  warn: "text-amber-800 bg-amber-50",
  manual: "text-slate-600 bg-slate-100",
};

export function NvoipTrunksHomologationPanel({
  voiceEnabled,
  linked,
  balanceAlertEmails,
  recordingRetentionDays,
  onPolicyChange,
  homologationLast,
  onHomologationComplete,
}: {
  voiceEnabled: boolean;
  linked: boolean;
  balanceAlertEmails: string;
  recordingRetentionDays: string;
  onPolicyChange: (patch: {
    balanceAlertEmails?: string;
    recordingRetentionDays?: string;
  }) => void;
  homologationLast: HomologationResult["summary"] & { ranAt: string } | null;
  onHomologationComplete?: (result: HomologationResult) => void;
}) {
  const { t } = useI18n();
  const [trunks, setTrunks] = useState<TrunkRow[]>([]);
  const [trunkForm, setTrunkForm] = useState({ name: "", defaultCaller: "", isDefault: false });
  const [trunkBusy, setTrunkBusy] = useState(false);
  const [homologation, setHomologation] = useState<HomologationResult | null>(null);
  const [homologationRunning, setHomologationRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrunks = useCallback(async () => {
    try {
      const res = await api.get<{ data: TrunkRow[] }>("/settings/nvoip/trunks");
      setTrunks(res.data ?? []);
    } catch {
      setTrunks([]);
    }
  }, []);

  useEffect(() => {
    if (voiceEnabled && linked) void loadTrunks();
  }, [voiceEnabled, linked, loadTrunks]);

  if (!voiceEnabled) return null;

  return (
    <div className="mt-8 space-y-6">
      <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <h3 className="text-sm font-semibold">{t("nvoip.trunks.title")}</h3>
        <p className="mt-1 text-xs text-slate-500">{t("nvoip.trunks.hint")}</p>
        {linked ? (
          <>
            <ul className="mt-3 space-y-2">
              {trunks.map((tr) => (
                <li
                  key={tr.id}
                  className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1.5 text-sm dark:border-ink-800"
                >
                  <span>
                    <strong>{tr.name}</strong> · {tr.defaultCaller}
                    {tr.isDefault ? (
                      <span className="ml-2 text-xs text-brand-600">({t("nvoip.trunks.default")})</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() =>
                      void api
                        .delete(`/settings/nvoip/trunks/${tr.id}`)
                        .then(() => void loadTrunks())
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
            {trunks.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">{t("nvoip.trunks.empty")}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                placeholder={t("nvoip.trunks.name")}
                value={trunkForm.name}
                onChange={(e) => setTrunkForm((s) => ({ ...s, name: e.target.value }))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <input
                placeholder={t("nvoip.trunks.caller")}
                value={trunkForm.defaultCaller}
                onChange={(e) => setTrunkForm((s) => ({ ...s, defaultCaller: e.target.value }))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-ink-700 dark:bg-ink-950"
              />
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={trunkForm.isDefault}
                  onChange={(e) => setTrunkForm((s) => ({ ...s, isDefault: e.target.checked }))}
                />
                {t("nvoip.trunks.default")}
              </label>
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={trunkBusy}
                onClick={() => {
                  setTrunkBusy(true);
                  void api
                    .post("/settings/nvoip/trunks", trunkForm)
                    .then(() => {
                      setTrunkForm({ name: "", defaultCaller: "", isDefault: false });
                      void loadTrunks();
                    })
                    .catch((e) =>
                      setError(e instanceof ApiError ? e.message : t("nvoip.trunks.error")),
                    )
                    .finally(() => setTrunkBusy(false));
                }}
              >
                {trunkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-xs text-slate-500">{t("nvoip.trunks.needConnected")}</p>
        )}
      </div>

      <div className="max-w-xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <h3 className="text-sm font-semibold">{t("nvoip.policy.title")}</h3>
        <label className="mt-3 block text-sm">
          <span className="font-medium">{t("nvoip.policy.alertEmails")}</span>
          <input
            value={balanceAlertEmails}
            onChange={(e) => onPolicyChange({ balanceAlertEmails: e.target.value })}
            placeholder="admin@empresa.com, financeiro@empresa.com"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
          />
        </label>
        <p className="mt-1 text-xs text-slate-500">{t("nvoip.policy.alertEmailsHint")}</p>
        <label className="mt-3 block text-sm">
          <span className="font-medium">{t("nvoip.policy.recordingRetention")}</span>
          <input
            type="number"
            min={1}
            value={recordingRetentionDays}
            onChange={(e) => onPolicyChange({ recordingRetentionDays: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
          />
        </label>
      </div>

      <div className="max-w-2xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-brand-600" />
            <h3 className="text-sm font-semibold">{t("nvoip.homologation.title")}</h3>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={homologationRunning || !linked}
            onClick={() => {
              setHomologationRunning(true);
              setError(null);
              void api
                .post<HomologationResult>("/settings/nvoip/homologation/run", {})
                .then((res) => {
                  setHomologation(res);
                  onHomologationComplete?.(res);
                })
                .catch((e) =>
                  setError(e instanceof ApiError ? e.message : t("nvoip.homologation.error")),
                )
                .finally(() => setHomologationRunning(false));
            }}
          >
            {homologationRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t("nvoip.homologation.run")
            )}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t("nvoip.homologation.hint")}</p>
        {homologationLast ? (
          <p className="mt-2 text-xs text-slate-500">
            {t("nvoip.homologation.lastRun").replace(
              "{at}",
              new Date(homologationLast.ranAt).toLocaleString(),
            )}{" "}
            —{" "}
            {homologationLast.pass} ok / {homologationLast.fail} falha
          </p>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        {homologation ? (
          <ul className="mt-4 space-y-2">
            {homologation.checks.map((c) => (
              <li
                key={c.id}
                className={`rounded-lg px-3 py-2 text-sm ${statusClass[c.status]}`}
              >
                <p className="font-medium">{c.label}</p>
                <p className="mt-0.5 text-xs opacity-90">{c.message}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
