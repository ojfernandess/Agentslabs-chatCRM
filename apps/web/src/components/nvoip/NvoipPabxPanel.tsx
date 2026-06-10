import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { NvoipPabxTrunkPanel } from "./NvoipPabxTrunkPanel";

const NVOIP_PANEL_URL = "https://painel.nvoip.com.br";

function sameNumbersip(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  return Boolean(da && db && da === db);
}

function mapNvoipUserError(message: string, t: (key: string) => string): string {
  if (message === "nvoip_primary_user_not_editable") return t("nvoip.pabx.primaryNotEditable");
  if (message === "sip_user_not_found") return t("nvoip.pabx.userNotFound");
  return message;
}

export type SipUserRow = {
  numbersip: string;
  name: string | null;
  caller: string | null;
  blocked: boolean;
  webphone: boolean | null;
  syncedAt?: string;
};

type UraPayload = {
  menus: number;
  queues: number;
  schedules: number;
  audios: number;
  users: number;
};

type Props = {
  linked: boolean;
  accountNumbersip: string;
  sipUsers: SipUserRow[];
  directorySyncedAt: string | null;
  syncingUsers: boolean;
  onSync: () => Promise<void>;
  onSipUsersChange: (users: SipUserRow[]) => void;
  onError: (message: string) => void;
};

export function NvoipPabxPanel({
  linked,
  accountNumbersip,
  sipUsers,
  directorySyncedAt,
  syncingUsers,
  onSync,
  onSipUsersChange,
  onError,
}: Props) {
  const { t } = useI18n();
  const [ura, setUra] = useState<UraPayload | null>(null);
  const [loadingUra, setLoadingUra] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", caller: "", webphone: true });
  const [creating, setCreating] = useState(false);

  const loadUra = useCallback(async () => {
    setLoadingUra(true);
    try {
      const data = await api.get<UraPayload>("/settings/nvoip/ura");
      setUra(data);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("nvoip.ura.loadError"));
    } finally {
      setLoadingUra(false);
    }
  }, [onError, t]);

  const applySipResponse = (users?: SipUserRow[]) => {
    if (users) onSipUsersChange(users);
  };

  return (
    <div className="mt-8 max-w-4xl space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("nvoip.pabx.title")}</h3>
        <p className="mt-1 text-xs text-slate-500">{t("nvoip.pabx.subtitle")}</p>
        <a
          href={NVOIP_PANEL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {t("nvoip.pabx.panelLink")}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <NvoipPabxTrunkPanel linked={linked} accountNumbersip={accountNumbersip} onError={onError} />

      <div className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("nvoip.ura.title")}</h4>
            <p className="mt-1 text-xs text-slate-500">{t("nvoip.pabx.uraHint")}</p>
          </div>
          <button type="button" className="btn-secondary text-sm" disabled={loadingUra} onClick={() => void loadUra()}>
            {loadingUra ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.ura.load")}
          </button>
        </div>
        {ura ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {(
              [
                ["menus", ura.menus],
                ["queues", ura.queues],
                ["schedules", ura.schedules],
                ["audios", ura.audios],
                ["users", ura.users],
              ] as const
            ).map(([key, count]) => (
              <div key={key} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-ink-950">
                <dt className="text-xs text-slate-500">{t(`nvoip.ura.${key}`)}</dt>
                <dd className="text-lg font-semibold text-slate-900 dark:text-ink-50">{count}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-xs text-slate-500">{t("nvoip.pabx.uraEmpty")}</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-800 dark:text-ink-200">{t("nvoip.sipUsersTitle")}</h4>
            <p className="mt-1 text-xs text-slate-500">{t("nvoip.pabx.sipHint")}</p>
            {directorySyncedAt ? (
              <p className="mt-1 text-xs text-slate-400">
                {t("nvoip.sipUsersSyncedAt").replace("{at}", new Date(directorySyncedAt).toLocaleString())}
              </p>
            ) : null}
          </div>
          <button type="button" className="btn-secondary text-sm" disabled={syncingUsers} onClick={() => void onSync()}>
            {syncingUsers ? (
              <>
                <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                {t("nvoip.sipUsersSyncing")}
              </>
            ) : (
              t("nvoip.sipUsersSync")
            )}
          </button>
        </div>

        {sipUsers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t("nvoip.sipUsersEmpty")}</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-ink-800">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-ink-800 dark:bg-ink-900">
                <tr>
                  <th className="px-3 py-2">{t("nvoip.sipUsersColNumbersip")}</th>
                  <th className="px-3 py-2">{t("nvoip.sipUsersColName")}</th>
                  <th className="px-3 py-2">{t("nvoip.sipUsersColCaller")}</th>
                  <th className="px-3 py-2">{t("nvoip.pabx.colWebphone")}</th>
                  <th className="px-3 py-2">{t("nvoip.sipUsersColBlocked")}</th>
                  <th className="px-3 py-2">{t("nvoip.pabx.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {sipUsers.map((su) => (
                  <SipUserEditRow
                    key={su.numbersip}
                    user={su}
                    isPrimary={sameNumbersip(su.numbersip, accountNumbersip)}
                    onError={onError}
                    onUpdated={applySipResponse}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-ink-800">
          <p className="text-xs font-medium text-slate-700 dark:text-ink-200">{t("nvoip.sipCreate.title")}</p>
          <p className="mt-1 text-xs text-slate-500">{t("nvoip.sipCreate.hint")}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              placeholder={t("nvoip.sipUsersColName")}
              value={createForm.name}
              onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))}
              className="min-w-[120px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
            />
            <input
              placeholder={t("nvoip.sipUsersColCaller")}
              value={createForm.caller}
              onChange={(e) => setCreateForm((s) => ({ ...s, caller: e.target.value }))}
              className="min-w-[80px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-950"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-ink-300">
              <input
                type="checkbox"
                checked={createForm.webphone}
                onChange={(e) => setCreateForm((s) => ({ ...s, webphone: e.target.checked }))}
              />
              {t("nvoip.pabx.webphone")}
            </label>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={creating || !createForm.name.trim() || !createForm.caller.trim()}
              onClick={() => {
                setCreating(true);
                void api
                  .post<{ ok: boolean; sipUsers?: SipUserRow[] }>("/settings/nvoip/users", {
                    name: createForm.name.trim(),
                    caller: createForm.caller.trim(),
                    webphone: createForm.webphone,
                  })
                  .then((res) => {
                    setCreateForm({ name: "", caller: "", webphone: true });
                    void onSync();
                    if (res.sipUsers) applySipResponse(res.sipUsers);
                  })
                  .catch((e) =>
                    onError(e instanceof ApiError ? e.message : t("nvoip.sipCreate.error")),
                  )
                  .finally(() => setCreating(false));
              }}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("nvoip.sipCreate.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SipUserEditRow({
  user,
  isPrimary,
  onError,
  onUpdated,
}: {
  user: SipUserRow;
  isPrimary: boolean;
  onError: (message: string) => void;
  onUpdated: (users?: SipUserRow[]) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(user.name ?? "");
  const [webphone, setWebphone] = useState(user.webphone ?? false);
  const [blocked, setBlocked] = useState(user.blocked);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(user.name ?? "");
    setWebphone(user.webphone ?? false);
    setBlocked(user.blocked);
  }, [user.name, user.webphone, user.blocked, user.numbersip]);

  const dirty =
    !isPrimary &&
    (name.trim() !== (user.name ?? "").trim() ||
      webphone !== (user.webphone ?? false) ||
      blocked !== user.blocked);

  const save = async () => {
    if (isPrimary) {
      onError(t("nvoip.pabx.primaryNotEditable"));
      return;
    }
    const payload: Record<string, unknown> = {};
    if (name.trim() !== (user.name ?? "").trim()) payload.name = name.trim();
    if (webphone !== (user.webphone ?? false)) payload.webphone = webphone;
    if (blocked !== user.blocked) payload.blocked = blocked;
    if (Object.keys(payload).length === 0) return;

    setSaving(true);
    try {
      const res = await api.put<{ ok: boolean; sipUsers?: SipUserRow[] }>(
        `/settings/nvoip/users/${encodeURIComponent(user.numbersip)}`,
        payload,
      );
      onUpdated(res.sipUsers);
    } catch (e) {
      const raw = e instanceof ApiError ? e.message : t("nvoip.pabx.updateError");
      onError(mapNvoipUserError(raw, t));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (isPrimary) {
      onError(t("nvoip.pabx.primaryNotEditable"));
      return;
    }
    if (!window.confirm(t("nvoip.pabx.deleteConfirm").replace("{name}", user.name || user.numbersip))) {
      return;
    }
    setDeleting(true);
    try {
      const res = await api.delete<{ ok: boolean; sipUsers?: SipUserRow[] }>(
        `/settings/nvoip/users/${encodeURIComponent(user.numbersip)}`,
      );
      onUpdated(res.sipUsers);
    } catch (e) {
      const raw = e instanceof ApiError ? e.message : t("nvoip.pabx.deleteError");
      onError(mapNvoipUserError(raw, t));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <tr className="border-t border-slate-100 dark:border-ink-800">
      <td className="px-3 py-2 font-mono text-xs">{user.numbersip}</td>
      <td className="px-3 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPrimary}
          className="w-full min-w-[6rem] rounded border border-slate-200 px-2 py-1 text-sm disabled:opacity-60 dark:border-ink-700 dark:bg-ink-950"
        />
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {user.caller ?? "—"}
        {isPrimary ? (
          <span className="ml-1 block text-[10px] font-normal text-amber-700 dark:text-amber-300">
            {t("nvoip.pabx.primaryBadge")}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={webphone}
          disabled={isPrimary}
          onChange={(e) => setWebphone(e.target.checked)}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={blocked}
          disabled={isPrimary}
          onChange={(e) => setBlocked(e.target.checked)}
        />
      </td>
      <td className="px-3 py-2">
        {isPrimary ? (
          <span className="text-xs text-slate-500">{t("nvoip.pabx.primaryHint")}</span>
        ) : (
          <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("nvoip.extensionSave")}
          </button>
          <button
            type="button"
            className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            disabled={deleting}
            title={t("nvoip.pabx.delete")}
            onClick={() => void remove()}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
        )}
      </td>
    </tr>
  );
}
