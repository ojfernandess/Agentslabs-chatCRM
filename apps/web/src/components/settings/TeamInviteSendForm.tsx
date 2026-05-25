import { useState, type FormEvent } from "react";
import { Copy, Mail } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type TeamInviteSendFormProps = {
  onSent?: () => void;
};

export function TeamInviteSendForm({ onSent }: TeamInviteSendFormProps) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [sending, setSending] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [copyOk, setCopyOk] = useState(false);

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
      onSent?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.invitesSendError"));
    } finally {
      setSending(false);
    }
  };

  const copyLink = async () => {
    if (!lastInviteUrl) return;
    try {
      await navigator.clipboard.writeText(lastInviteUrl);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      window.prompt(t("settings.invitesCopyPrompt"), lastInviteUrl);
    }
  };

  return (
    <div className="mb-6 space-y-4 rounded-xl border border-ink-200/80 bg-ink-50/50 p-4 dark:border-white/10 dark:bg-white/5">
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
            placeholder="agente@exemplo.com"
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
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          <button type="submit" className="btn-primary" disabled={sending}>
            {sending ? t("common.saving") : t("settings.invitesSend")}
          </button>
          {lastInviteUrl ? (
            <button type="button" className="btn-secondary inline-flex items-center gap-1" onClick={() => void copyLink()}>
              <Copy className="h-4 w-4" />
              {copyOk ? t("settings.invitesCopied") : t("settings.invitesCopyLink")}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
