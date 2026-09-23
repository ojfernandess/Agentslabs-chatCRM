import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, LifeBuoy, Paperclip, Plus, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  settingsCard,
  settingsInput,
  settingsListWrap,
  settingsMuted,
  settingsTitle,
} from "@/components/settings/settingsUi";

type HelpdeskCategory = "IMPORT_DATA" | "EXPORT_DATA" | "IMPLEMENTATION" | "GENERAL";
type HelpdeskStatus = "OPEN" | "ACCEPTED" | "IN_PROGRESS" | "WAITING_ORG" | "RESOLVED" | "CLOSED";

type HelpdeskAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

type HelpdeskMessage = {
  id: string;
  body: string;
  isStaffReply: boolean;
  createdAt: string;
  author: { id: string; name: string; email: string };
  attachments: HelpdeskAttachment[];
};

type HelpdeskRequestSummary = {
  id: string;
  category: HelpdeskCategory;
  subject: string;
  status: HelpdeskStatus;
  progressPercent: number | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type HelpdeskRequestDetail = HelpdeskRequestSummary & {
  description: string;
  progressNote: string | null;
  attachments: HelpdeskAttachment[];
  messages: HelpdeskMessage[];
};

const CATEGORIES: HelpdeskCategory[] = ["IMPORT_DATA", "EXPORT_DATA", "IMPLEMENTATION", "GENERAL"];

function statusClass(status: HelpdeskStatus): string {
  if (status === "RESOLVED" || status === "CLOSED") {
    return "bg-emerald-500/15 text-emerald-800 ring-emerald-500/25 dark:text-emerald-200";
  }
  if (status === "IN_PROGRESS" || status === "ACCEPTED") {
    return "bg-brand-500/15 text-brand-800 ring-brand-500/25 dark:text-brand-200";
  }
  if (status === "WAITING_ORG") {
    return "bg-amber-500/15 text-amber-900 ring-amber-500/25 dark:text-amber-200";
  }
  return "bg-ink-100 text-ink-700 ring-ink-200 dark:bg-ink-800 dark:text-ink-200";
}

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

export function SettingsHelpdeskPanel() {
  const { t, locale } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const [requests, setRequests] = useState<HelpdeskRequestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HelpdeskRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const [category, setCategory] = useState<HelpdeskCategory>("GENERAL");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.get<HelpdeskRequestSummary[]>("/helpdesk/requests");
      setRequests(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.helpdesk.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadDetail = useCallback(
    async (id: string) => {
      setError("");
      try {
        const row = await api.get<HelpdeskRequestDetail>(`/helpdesk/requests/${id}`);
        setDetail(row);
        setSelectedId(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("settings.helpdesk.loadFailed"));
      }
    },
    [t],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const submitCreate = async () => {
    if (!subject.trim() || !description.trim()) {
      setError(t("settings.helpdesk.requiredFields"));
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const form = new FormData();
      form.append("category", category);
      form.append("subject", subject.trim());
      form.append("description", description.trim());
      for (const file of createFiles) form.append("file", file);
      await api.postMultipart("/helpdesk/requests", form);
      setShowCreate(false);
      setSubject("");
      setDescription("");
      setCreateFiles([]);
      setCategory("GENERAL");
      setSuccess(t("settings.helpdesk.createSuccess"));
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.helpdesk.createFailed"));
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
      await api.postMultipart(`/helpdesk/requests/${selectedId}/messages`, form);
      setReplyBody("");
      setReplyFiles([]);
      setSuccess(t("settings.helpdesk.replySuccess"));
      await loadDetail(selectedId);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.helpdesk.replyFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (selectedId && detail) {
    return (
      <div className={settingsCard}>
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            setDetail(null);
          }}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings.helpdesk.backToList")}
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {t(`settings.helpdesk.categories.${detail.category}` as "settings.helpdesk.categories.GENERAL")}
            </p>
            <h2 className={settingsTitle}>{detail.subject}</h2>
            <p className={settingsMuted}>{formatDateTime(detail.createdAt, locale)}</p>
          </div>
          <span className={clsx("inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1", statusClass(detail.status))}>
            {t(`settings.helpdesk.status.${detail.status}` as "settings.helpdesk.status.OPEN")}
          </span>
        </div>

        {detail.progressPercent != null || detail.progressNote ? (
          <div className="mt-4 rounded-xl border border-brand-200/70 bg-brand-50/60 p-4 dark:border-brand-900/40 dark:bg-brand-950/20">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("settings.helpdesk.progressTitle")}</p>
            {detail.progressPercent != null ? (
              <div className="mt-2">
                <div className="h-2 overflow-hidden rounded-full bg-white/80 dark:bg-ink-900">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${detail.progressPercent}%` }} />
                </div>
                <p className="mt-1 text-xs text-ink-500">{detail.progressPercent}%</p>
              </div>
            ) : null}
            {detail.progressNote ? <p className="mt-2 text-sm text-ink-700 dark:text-ink-200">{detail.progressNote}</p> : null}
          </div>
        ) : null}

        <div className="mt-4 rounded-xl border border-ink-200/80 bg-ink-50/60 p-4 dark:border-soft-border dark:bg-black/10">
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

        <div className="mt-6 space-y-3">
          {detail.messages.map((msg) => (
            <div
              key={msg.id}
              className={clsx(
                "rounded-xl border px-4 py-3",
                msg.isStaffReply
                  ? "border-brand-200/70 bg-brand-50/50 dark:border-brand-900/40 dark:bg-brand-950/20"
                  : "border-ink-200/80 bg-white dark:border-soft-border dark:bg-ink-950/40",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                  {msg.isStaffReply ? t("settings.helpdesk.platformReply") : msg.author.name}
                </p>
                <p className="text-xs text-ink-500">{formatDateTime(msg.createdAt, locale)}</p>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700 dark:text-ink-200">{msg.body}</p>
              {msg.attachments.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {msg.attachments.map((file) => (
                    <li key={file.id}>
                      <a href={file.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline dark:text-brand-300">
                        {file.originalName}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>

        {detail.status !== "CLOSED" && detail.status !== "RESOLVED" ? (
          <div className="mt-6 rounded-xl border border-ink-200/80 p-4 dark:border-soft-border">
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-200">{t("settings.helpdesk.replyLabel")}</label>
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              rows={4}
              className={clsx(settingsInput, "mt-2")}
              placeholder={t("settings.helpdesk.replyPlaceholder")}
            />
            <input
              ref={replyFileRef}
              type="file"
              multiple
              accept="image/*,.pdf,.csv,.json,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary" onClick={() => replyFileRef.current?.click()}>
                <Paperclip className="h-4 w-4" />
                {replyFiles.length ? replyFiles.map((f) => f.name).join(", ") : t("settings.helpdesk.attachFiles")}
              </button>
              <button type="button" className="btn-primary" disabled={saving} onClick={() => void submitReply()}>
                <Send className="h-4 w-4" />
                {saving ? t("common.saving") : t("settings.helpdesk.sendReply")}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {success ? <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">{success}</p> : null}
      </div>
    );
  }

  if (showCreate) {
    return (
      <div className={settingsCard}>
        <button
          type="button"
          onClick={() => setShowCreate(false)}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings.helpdesk.backToList")}
        </button>
        <h2 className={settingsTitle}>{t("settings.helpdesk.createTitle")}</h2>
        <p className={settingsMuted}>{t("settings.helpdesk.createHint")}</p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.helpdesk.categoryLabel")}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as HelpdeskCategory)} className={clsx(settingsInput, "mt-1")}>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`settings.helpdesk.categories.${value}` as "settings.helpdesk.categories.GENERAL")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.helpdesk.subjectLabel")}</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={clsx(settingsInput, "mt-1")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.helpdesk.descriptionLabel")}</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} className={clsx(settingsInput, "mt-1")} />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.csv,.json,.txt,.xlsx,.xls"
            className="hidden"
            onChange={(e) => setCreateFiles(Array.from(e.target.files ?? []))}
          />
          <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
            {createFiles.length ? createFiles.map((f) => f.name).join(", ") : t("settings.helpdesk.attachFiles")}
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void submitCreate()}>
            {saving ? t("common.saving") : t("settings.helpdesk.submitRequest")}
          </button>
        </div>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={settingsCard}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
            <LifeBuoy className="h-3.5 w-3.5" />
            {t("settings.helpdesk.badge")}
          </div>
          <h2 className={settingsTitle}>{t("settings.helpdesk.title")}</h2>
          <p className={settingsMuted}>{t("settings.helpdesk.subtitle")}</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          {t("settings.helpdesk.newRequest")}
        </button>
      </div>

      {loading ? (
        <div className="mt-8 flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
        </div>
      ) : requests.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-500 dark:border-soft-border">
          {t("settings.helpdesk.empty")}
        </p>
      ) : (
        <ul className={clsx(settingsListWrap, "mt-6 divide-y divide-ink-100 dark:divide-soft-border")}>
          {requests.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void loadDetail(row.id)}
                className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left hover:bg-ink-50/80 dark:hover:bg-black/10"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    {t(`settings.helpdesk.categories.${row.category}` as "settings.helpdesk.categories.GENERAL")}
                  </p>
                  <p className="truncate font-medium text-ink-900 dark:text-ink-50">{row.subject}</p>
                  <p className="mt-1 text-xs text-ink-500">{formatDateTime(row.updatedAt, locale)}</p>
                </div>
                <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1", statusClass(row.status))}>
                  {t(`settings.helpdesk.status.${row.status}` as "settings.helpdesk.status.OPEN")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {success ? <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">{success}</p> : null}
    </div>
  );
}
