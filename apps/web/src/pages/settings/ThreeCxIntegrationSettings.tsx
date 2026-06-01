import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Phone, Plus, RefreshCw, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type RoutePointRow = {
  id: string;
  name: string;
  pbxBaseUrl: string;
  clientId: string;
  routePointDn: string;
  sourceExtensionDn: string | null;
  status: string;
  crmBaseUrl: string;
  lastError: string | null;
};

type InboxOption = { id: string; name: string; isDefault: boolean };

type CreateResponse = RoutePointRow & {
  crmApiKey?: string;
  crmEndpoints?: Record<string, string>;
};

export function ThreeCxIntegrationSettings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<RoutePointRow[]>([]);
  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newCrmKey, setNewCrmKey] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    pbxBaseUrl: "",
    clientId: "",
    apiKey: "",
    routePointDn: "",
    sourceExtensionDn: "",
    inboxId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rp, ib] = await Promise.all([
        api.get<{ data: RoutePointRow[] }>("/settings/threecx/route-points"),
        api.get<InboxOption[]>("/settings/threecx/inboxes"),
      ]);
      setRows(rp.data ?? []);
      setInboxes(ib);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("threecx.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<CreateResponse>("/settings/threecx/route-points", {
        name: form.name,
        pbxBaseUrl: form.pbxBaseUrl,
        clientId: form.clientId,
        apiKey: form.apiKey,
        routePointDn: form.routePointDn,
        sourceExtensionDn: form.sourceExtensionDn || null,
        inboxId: form.inboxId || null,
      });
      if (res.crmApiKey) setNewCrmKey(res.crmApiKey);
      setShowForm(false);
      setForm({
        name: "",
        pbxBaseUrl: "",
        clientId: "",
        apiKey: "",
        routePointDn: "",
        sourceExtensionDn: "",
        inboxId: "",
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("threecx.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("threecx.deleteConfirm"))) return;
    try {
      await api.delete(`/settings/threecx/route-points/${id}`);
      await load();
    } catch {
      setError(t("threecx.deleteError"));
    }
  };

  const test = async (id: string) => {
    try {
      await api.post(`/settings/threecx/route-points/${id}/test`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("threecx.testError"));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 dark:text-ink-50">{t("threecx.title")}</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-ink-400">{t("threecx.subtitle")}</p>
      <a
        href="https://www.3cx.com.br/docs/configuracao-api-3cx/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        {t("threecx.docsLink")}
      </a>

      {newCrmKey ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/40">
          <p className="font-semibold text-amber-900 dark:text-amber-100">{t("threecx.crmKeyTitle")}</p>
          <p className="mt-1 font-mono text-xs break-all">{newCrmKey}</p>
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{t("threecx.crmKeyHint")}</p>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-4 w-4" />
          {t("threecx.addRoutePoint")}
        </button>
        <button type="button" className="btn-ghost text-sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          {t("common.refresh")}
        </button>
      </div>

      {showForm ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          {(
            [
              ["name", form.name, (v: string) => setForm((f) => ({ ...f, name: v }))],
              ["pbxBaseUrl", form.pbxBaseUrl, (v: string) => setForm((f) => ({ ...f, pbxBaseUrl: v }))],
              ["clientId", form.clientId, (v: string) => setForm((f) => ({ ...f, clientId: v }))],
              ["apiKey", form.apiKey, (v: string) => setForm((f) => ({ ...f, apiKey: v }))],
              ["routePointDn", form.routePointDn, (v: string) => setForm((f) => ({ ...f, routePointDn: v }))],
              [
                "sourceExtensionDn",
                form.sourceExtensionDn,
                (v: string) => setForm((f) => ({ ...f, sourceExtensionDn: v })),
              ],
            ] as const
          ).map(([key, value, onChange]) => (
            <label key={key} className="block text-sm">
              <span className="font-medium">{t(`threecx.field.${key}`)}</span>
              <input
                type={key === "apiKey" ? "password" : "text"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="font-medium">{t("threecx.field.inbox")}</span>
            <select
              value={form.inboxId}
              onChange={(e) => setForm((f) => ({ ...f, inboxId: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 dark:border-ink-700 dark:bg-ink-950"
            >
              <option value="">{t("threecx.field.inboxNone")}</option>
              {inboxes.map((ib) => (
                <option key={ib.id} value={ib.id}>
                  {ib.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary text-sm" disabled={saving} onClick={() => void create()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("threecx.save")}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-slate-500">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">{t("threecx.empty")}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-slate-200 p-4 dark:border-ink-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-ink-50">{row.name}</p>
                  <p className="text-xs text-slate-500">
                    DN {row.routePointDn} · {row.pbxBaseUrl}
                  </p>
                  <span
                    className={clsx(
                      "mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium",
                      row.status === "CONNECTED"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                        : "bg-slate-100 text-slate-600 dark:bg-ink-800 dark:text-ink-400",
                    )}
                  >
                    {row.status}
                  </span>
                  {row.lastError ? (
                    <p className="mt-1 text-xs text-red-600">{row.lastError}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost text-xs" onClick={() => void test(row.id)}>
                    {t("threecx.test")}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-red-600"
                    onClick={() => void remove(row.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => void copy(row.crmBaseUrl)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("threecx.copyCrmBase")}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-ink-500">{t("threecx.crmTemplateHint")}</p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs text-slate-500 dark:text-ink-500">
        <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("threecx.messagingNote")}
      </p>
    </div>
  );
}
