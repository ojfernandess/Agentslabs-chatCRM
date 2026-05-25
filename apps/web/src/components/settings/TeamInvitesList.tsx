import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export type InviteRow = {
  id: string;
  email: string;
  role: "ADMIN" | "AGENT";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string; email: string };
};

export function TeamInvitesList() {
  const { t } = useI18n();
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [copyOk, setCopyOk] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<InviteRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

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

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await api.delete(`/users/invites/${revokeTarget.id}`);
      setRevokeTarget(null);
      await load();
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : t("settings.invitesRevokeError"));
    } finally {
      setRevokeBusy(false);
    }
  };

  const statusLabel = (s: InviteRow["status"]) => t(`settings.invitesStatus_${s}`);

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {lastInviteUrl ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/80 px-3 py-2 dark:border-brand-800 dark:bg-brand-950/30">
          <p className="min-w-0 flex-1 truncate text-xs text-ink-600 dark:text-ink-400">{lastInviteUrl}</p>
          <button
            type="button"
            className="btn-secondary inline-flex shrink-0 items-center gap-1 text-xs"
            onClick={() => void copyLink(lastInviteUrl)}
          >
            <Copy className="h-3.5 w-3.5" />
            {copyOk ? t("settings.invitesCopied") : t("settings.invitesCopyLink")}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-500">{t("common.loading")}</p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-ink-500">{t("settings.invitesEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-ink-200/80 dark:border-white/10">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200/80 bg-ink-50 text-xs font-medium uppercase tracking-wide text-ink-500 dark:border-white/10 dark:bg-white/5">
                <th className="px-3 py-2">{t("settings.invitesEmail")}</th>
                <th className="px-3 py-2">{t("settings.invitesRole")}</th>
                <th className="px-3 py-2">{t("settings.invitesStatus")}</th>
                <th className="px-3 py-2">{t("settings.invitesExpires")}</th>
                <th className="px-3 py-2">{t("settings.invitesSentAt")}</th>
                <th className="px-3 py-2 text-right">{t("settings.tagsColActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {invites.map((row) => (
                <tr key={row.id} className="bg-white dark:bg-transparent">
                  <td className="px-3 py-2 font-medium text-ink-900 dark:text-ink-100">{row.email}</td>
                  <td className="px-3 py-2 text-ink-600 dark:text-ink-400">{row.role}</td>
                  <td className="px-3 py-2">{statusLabel(row.status)}</td>
                  <td className="px-3 py-2 text-ink-500">
                    {new Date(row.expiresAt).toLocaleDateString("pt-BR", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-2 text-ink-500">
                    {new Date(row.createdAt).toLocaleDateString("pt-BR", {
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
                          onClick={() => {
                            setRevokeError(null);
                            setRevokeTarget(row);
                          }}
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

      <ConfirmDialog
        open={revokeTarget != null}
        title={t("settings.invitesRevokeTitle")}
        message={t("settings.invitesRevokeConfirm")}
        confirmLabel={t("settings.invitesRevoke")}
        variant="danger"
        loading={revokeBusy}
        error={revokeError}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => {
          if (!revokeBusy) setRevokeTarget(null);
        }}
      />
    </div>
  );
}
