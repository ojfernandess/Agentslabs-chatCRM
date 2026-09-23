import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, LifeBuoy, Paperclip, RefreshCw, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { SuperAdminPageHeader, SuperAdminPanel } from "@/components/super-admin/SuperAdminShell";

type HelpdeskCategory = "IMPORT_DATA" | "EXPORT_DATA" | "IMPLEMENTATION" | "GENERAL";
type HelpdeskStatus = "OPEN" | "ACCEPTED" | "IN_PROGRESS" | "WAITING_ORG" | "RESOLVED" | "CLOSED";

type HelpdeskAttachment = {
  id: string;
  originalName: string;
  url: string;
};

type HelpdeskMessage = {
  id: string;
  body: string;
  isStaffReply: boolean;
  createdAt: string;
  author: { name: string; email: string };
  attachments: HelpdeskAttachment[];
};

type HelpdeskRequestSummary = {
  id: string;
  organizationId: string;
  organization: { id: string; name: string; slug: string } | null;
  category: HelpdeskCategory;
  subject: string;
  status: HelpdeskStatus;
  progressPercent: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { name: string; email: string };
};

type HelpdeskRequestDetail = HelpdeskRequestSummary & {
  description: string;
  progressNote: string | null;
  attachments: HelpdeskAttachment[];
  messages: HelpdeskMessage[];
};

const STATUSES: HelpdeskStatus[] = ["OPEN", "ACCEPTED", "IN_PROGRESS", "WAITING_ORG", "RESOLVED", "CLOSED"];

function formatDateTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function SuperAdminHelpdeskPanel() {
  const { t, locale } = useI18n();
  const replyFileRef = useRef<HTMLInputElement>(null);

  const [requests, setRequests] = useState<HelpdeskRequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HelpdeskRequestDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [progressNote, setProgressNote] = useState("");
  const [progressPercent, setProgressPercent] = useState<number | "">("");
  const [status, setStatus] = useState<HelpdeskStatus>("OPEN");
  const [replyBody, setReplyBody] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const rows = await api.get<HelpdeskRequestSummary[]>(`/super/helpdesk/requests${query}`);
      setRequests(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("superAdmin.orgHelpdesk.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const row = await api.get<HelpdeskRequestDetail>(`/super/helpdesk/requests/${id}`);
        setDetail(row);
        setSelectedId(id);
        setProgressNote(row.progressNote ?? "");
        setProgressPercent(row.progressPercent ?? "");
        setStatus(row.status);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("superAdmin.orgHelpdesk.loadFailed"));
      }
    },
    [t],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const saveRequest = async (patch: Record<string, unknown>) => {
    if (!selectedId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await api.patch<HelpdeskRequestDetail>(`/super/helpdesk/requests/${selectedId}`, patch);
      setDetail(updated);
      setProgressNote(updated.progressNote ?? "");
      setProgressPercent(updated.progressPercent ?? "");
      setStatus(updated.status);
      setSuccess(t("superAdmin.orgHelpdesk.saved"));
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("superAdmin.orgHelpdesk.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const submitReply = async () => {
    if (!selectedId) return;
    if (!replyBody.trim() && replyFiles.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.append("body", replyBody.trim());
      for (const file of replyFiles) form.append("file", file);
      const updated = await api.postMultipart<HelpdeskRequestDetail>(`/super/helpdesk/requests/${selectedId}/messages`, form);
      setDetail(updated);
      setReplyBody("");
      setReplyFiles([]);
      setSuccess(t("superAdmin.orgHelpdesk.replySent"));
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("superAdmin.orgHelpdesk.replyFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SuperAdminPanel className="p-0">
      <SuperAdminPageHeader
        title={t("superAdmin.orgHelpdesk.title")}
        subtitle={t("superAdmin.orgHelpdesk.subtitle")}
        icon={
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/20">
            <LifeBuoy className="h-5 w-5" />
          </div>
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white dark:border-ink-700 dark:bg-ink-950/40">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-ink-800">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">{t("superAdmin.orgHelpdesk.allStatuses")}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`superAdmin.orgHelpdesk.status.${value}` as "superAdmin.orgHelpdesk.status.OPEN")}
                </option>
              ))}
            </select>
            <button type="button" className="btn-secondary px-2 py-1" onClick={() => void loadList()}>
              <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            </div>
          ) : requests.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-500">{t("superAdmin.orgHelpdesk.empty")}</p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-auto dark:divide-ink-800">
              {requests.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => void loadDetail(row.id)}
                    className={clsx(
                      "w-full px-4 py-3 text-left transition",
                      selectedId === row.id ? "bg-brand-50/80 dark:bg-brand-950/20" : "hover:bg-slate-50 dark:hover:bg-ink-900/40",
                    )}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      {row.organization?.name ?? row.organizationId}
                    </p>
                    <p className="font-medium text-ink-900 dark:text-ink-50">{row.subject}</p>
                    <p className="mt-1 text-xs text-ink-500">
                      {t(`superAdmin.orgHelpdesk.categories.${row.category}` as "superAdmin.orgHelpdesk.categories.GENERAL")} ·{" "}
                      {t(`superAdmin.orgHelpdesk.status.${row.status}` as "superAdmin.orgHelpdesk.status.OPEN")}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-ink-700 dark:bg-ink-950/40">
          {!detail ? (
            <p className="py-16 text-center text-sm text-ink-500">{t("superAdmin.orgHelpdesk.selectRequest")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{detail.organization?.name}</p>
                  <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{detail.subject}</h3>
                  <p className="mt-1 text-xs text-ink-500">
                    {detail.createdBy.name} · {detail.createdBy.email} · {formatDateTime(detail.createdAt, locale)}
                  </p>
                </div>
                {detail.status === "OPEN" ? (
                  <button type="button" className="btn-primary" disabled={saving} onClick={() => void saveRequest({ accept: true })}>
                    <Check className="h-4 w-4" />
                    {t("superAdmin.orgHelpdesk.accept")}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50/70 p-4 dark:border-ink-800 dark:bg-ink-900/30">
                <p className="whitespace-pre-wrap text-sm text-ink-800 dark:text-ink-100">{detail.description}</p>
                {detail.attachments.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {detail.attachments.map((file) => (
                      <li key={file.id}>
                        <a href={file.url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline dark:text-brand-300">
                          {file.originalName}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-ink-500">{t("superAdmin.orgHelpdesk.statusLabel")}</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value as HelpdeskStatus)} className="input-field mt-1">
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {t(`superAdmin.orgHelpdesk.status.${value}` as "superAdmin.orgHelpdesk.status.OPEN")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-ink-500">{t("superAdmin.orgHelpdesk.progressPercent")}</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={progressPercent}
                    onChange={(e) => setProgressPercent(e.target.value === "" ? "" : Number(e.target.value))}
                    className="input-field mt-1"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-ink-500">{t("superAdmin.orgHelpdesk.progressNote")}</label>
                <textarea value={progressNote} onChange={(e) => setProgressNote(e.target.value)} rows={3} className="input-field mt-1" />
              </div>

              <button
                type="button"
                className="btn-secondary mt-4"
                disabled={saving}
                onClick={() =>
                  void saveRequest({
                    status,
                    progressNote: progressNote.trim() || null,
                    progressPercent: progressPercent === "" ? null : progressPercent,
                  })
                }
              >
                {saving ? t("common.saving") : t("superAdmin.orgHelpdesk.saveProgress")}
              </button>

              <div className="mt-6 space-y-3">
                {detail.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={clsx(
                      "rounded-xl border px-4 py-3",
                      msg.isStaffReply
                        ? "border-brand-200/70 bg-brand-50/50 dark:border-brand-900/40 dark:bg-brand-950/20"
                        : "border-ink-200/80 bg-white dark:border-ink-800 dark:bg-ink-900/20",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                        {msg.isStaffReply ? t("superAdmin.orgHelpdesk.platformReply") : msg.author.name}
                      </p>
                      <p className="text-xs text-ink-500">{formatDateTime(msg.createdAt, locale)}</p>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{msg.body}</p>
                  </div>
                ))}
              </div>

              {detail.status !== "CLOSED" ? (
                <div className="mt-6 rounded-xl border border-ink-200/80 p-4 dark:border-ink-800">
                  <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">{t("superAdmin.orgHelpdesk.replyLabel")}</label>
                  <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={4} className="input-field mt-2" />
                  <input
                    ref={replyFileRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.csv,.json,.txt,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []))}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => replyFileRef.current?.click()}>
                      <Paperclip className="h-4 w-4" />
                      {replyFiles.length ? replyFiles.map((f) => f.name).join(", ") : t("superAdmin.orgHelpdesk.attachFiles")}
                    </button>
                    <button type="button" className="btn-primary" disabled={saving} onClick={() => void submitReply()}>
                      <Send className="h-4 w-4" />
                      {saving ? t("common.saving") : t("superAdmin.orgHelpdesk.sendReply")}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          {success ? <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">{success}</p> : null}
        </div>
      </div>
    </SuperAdminPanel>
  );
}
