import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type InviteRow = {
  id: string;
  email: string;
  role: "ADMIN" | "AGENT";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string; email: string };
};

export function TeamInvitesPanel() {
  const { t } = useI18n();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [sending, setSending] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [copyOk, setCopyOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.get<InviteRow[]>("/users/invites");
      setInvites(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.invitesLoadError"));
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setCopyOk(false);
    setSending(true);
    try {
      const res = await api.post<{ inviteUrl: string }>("/users/invites", {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setLastInviteUrl(res.inviteUrl);
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.invitesSendError"));
    } finally {
      setSending(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      window.prompt(t("settings.invitesCopyPrompt"), url);
    }
  };

  const regenerateLink = async (id: string) => {
    setError("");
    try {
      const res = await api.post<{ inviteUrl: string }>(`/users/invites/${id}/regenerate-link`, {});
      setLastInviteUrl(res.inviteUrl);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.invitesCopyError"));
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm(t("settings.invitesRevokeConfirm"))) return;
    setError("");
    try {
      await api.delete(`/users/invites/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.invitesRevokeError"));
    }
  };

  const statusLabel = (s: InviteRow["status"]) => t(`settings.invitesStatus_${s}`);

  return (
    <div className="mb-8 space-y-4 rounded-xl border border-ink-200/80 bg-ink-50/50 p-4 dark:border-white/10 dark:bg-white/5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-100">
        <Mail className="h-4 w-4" />
        {t("settings.invitesTitle")}
      </h3>
      <p className="text-sm text-ink-500 dark:text-ink-400">{t("settings.invitesSubtitle")}</p>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <form onSubmit={(e) => void handleInvite(e)} className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-ink-600">{t("settings.invitesEmail")}</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
            className="mt-1 block w-full input-field"
            placeholder="agent@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-600">{t("settings.invitesRole")}</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "ADMIN" | "AGENT")}
            className="mt-1 block w-full input-field"
          >
            <option value="AGENT">{t("settings.invitesRoleAgent")}</option>
            <option value="ADMIN">{t("settings.invitesRoleAdmin")}</option>
          </select>
        </div>
        <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? t("common.saving") : t("settings.invitesSend")}
          </button>
          {lastInviteUrl ? (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1"
              onClick={() => void copyLink(lastInviteUrl)}
            >
              <Copy className="h-4 w-4" />
              {copyOk ? t("settings.invitesCopied") : t("settings.invitesCopyLink")}
            </button>
          ) : null}
        </div>
      </form>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("settings.invitesListTitle")}</h4>
        {loading ? (
          <p className="text-sm text-ink-500">{t("common.loading")}</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-ink-500">{t("settings.invitesEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ink-200/80 dark:border-white/10">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200/80 bg-white text-xs font-medium uppercase tracking-wide text-ink-500 dark:border-white/10 dark:bg-ink-900/40">
                  <th className="px-3 py-2">{t("settings.invitesEmail")}</th>
                  <th className="px-3 py-2">{t("settings.invitesRole")}</th>
                  <th className="px-3 py-2">{t("settings.invitesStatus")}</th>
                  <th className="px-3 py-2">{t("settings.invitesExpires")}</th>
                  <th className="px-3 py-2 text-right">{t("settings.tagsColActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 bg-white dark:divide-white/10 dark:bg-transparent">
                {invites.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium text-ink-900 dark:text-ink-100">{row.email}</td>
                    <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{row.role}</td>
                    <td className="px-3 py-2">{statusLabel(row.status)}</td>
                    <td className="px-3 py-2 text-ink-500">
                      {new Date(row.expiresAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            className="mr-2 text-xs font-medium text-brand-600 hover:underline"
                            onClick={() => void regenerateLink(row.id)}
                          >
                            {t("settings.invitesCopyLink")}
                          </button>
                          <button
                            type="button"
                            className="text-xs font-medium text-red-600 hover:underline"
                            onClick={() => void revoke(row.id)}
                          >
                            {t("settings.invitesRevoke")}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
