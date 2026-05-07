import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { Megaphone, Plus, RefreshCw, Trash2, Play } from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";

type CampaignTag = { tagId: string; tag: { id: string; name: string; color: string } };

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  messageType: string;
  body: string | null;
  templateId: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  tags: CampaignTag[];
  _count?: { recipients: number };
  audienceCount?: number | null;
}

interface TagOption {
  id: string;
  name: string;
  color: string;
}

interface TemplateOption {
  id: string;
  name: string;
}

export function BroadcastCampaignsPage() {
  const { t, dateLocale } = useI18n();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [tags, setTags] = useState<TagOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [messageType, setMessageType] = useState<"TEXT" | "TEMPLATE">("TEMPLATE");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListError("");
    try {
      const data = await api.get<CampaignRow[]>("/broadcasts");
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "";
      setListError(msg || t("broadcastPage.listError"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const hasRunning = rows.some((r) => r.status === "RUNNING");

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => void loadList(), 4000);
    return () => window.clearInterval(id);
  }, [hasRunning, loadList]);

  const openForm = async () => {
    setFormError("");
    setName("");
    setMessageType("TEMPLATE");
    setBody("");
    setTemplateId("");
    setSelectedTagIds([]);
    setPreviewCount(null);
    setShowForm(true);
    try {
      const [tagList, tplList] = await Promise.all([
        api.get<TagOption[]>("/tags"),
        api.get<TemplateOption[]>("/templates"),
      ]);
      setTags(Array.isArray(tagList) ? tagList : []);
      setTemplates(Array.isArray(tplList) ? tplList : []);
    } catch {
      setTags([]);
      setTemplates([]);
    }
  };

  const runPreview = async () => {
    if (selectedTagIds.length === 0) {
      setPreviewCount(null);
      return;
    }
    setPreviewBusy(true);
    try {
      const res = await api.post<{ audienceCount: number }>("/broadcasts/audience-preview", {
        tagIds: selectedTagIds,
      });
      setPreviewCount(typeof res.audienceCount === "number" ? res.audienceCount : 0);
    } catch {
      setPreviewCount(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  useEffect(() => {
    if (!showForm || selectedTagIds.length === 0) {
      setPreviewCount(null);
      return;
    }
    const h = window.setTimeout(() => void runPreview(), 400);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced preview
  }, [showForm, [...selectedTagIds].sort().join(",")]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreate = async () => {
    const nameTrim = name.trim();
    if (!nameTrim || selectedTagIds.length === 0) return;
    if (messageType === "TEXT" && !body.trim()) return;
    if (messageType === "TEMPLATE" && !templateId) return;

    setSubmitting(true);
    setFormError("");
    try {
      const payload: Record<string, unknown> = {
        name: nameTrim,
        messageType,
        tagIds: selectedTagIds,
      };
      if (messageType === "TEXT") payload.body = body.trim();
      else payload.templateId = templateId;

      await api.post("/broadcasts", payload);
      setShowForm(false);
      void loadList();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.createError");
      setFormError(msg || t("broadcastPage.createError"));
    } finally {
      setSubmitting(false);
    }
  };

  const startCampaign = async (id: string) => {
    setActionBusy(id);
    try {
      await api.post(`/broadcasts/${id}/start`);
      void loadList();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("broadcastPage.startError");
      alert(msg);
    } finally {
      setActionBusy(null);
    }
  };

  const deleteDraft = async (id: string) => {
    if (!window.confirm(t("broadcastPage.deleteConfirm"))) return;
    setActionBusy(id);
    try {
      await api.delete(`/broadcasts/${id}`);
      void loadList();
    } catch {
      /* ignore */
    } finally {
      setActionBusy(null);
    }
  };

  const statusLabel = (s: string) =>
    ({
      DRAFT: t("broadcastPage.statusDraft"),
      RUNNING: t("broadcastPage.statusRunning"),
      COMPLETED: t("broadcastPage.statusCompleted"),
      FAILED: t("broadcastPage.statusFailed"),
      CANCELLED: t("broadcastPage.statusCancelled"),
    })[s] ?? s;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink-900 dark:text-ink-50">
            <Megaphone className="h-7 w-7 text-brand-600" />
            {t("broadcastPage.title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600 dark:text-ink-400">
            {t("broadcastPage.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadList()}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t("common.refresh")}
          </button>
          <button type="button" onClick={() => void openForm()} className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {t("broadcastPage.newCampaign")}
          </button>
        </div>
      </header>

      {showForm ? (
        <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-700 dark:bg-ink-900">
          <h2 className="text-lg font-semibold text-ink-900 dark:text-ink-100">{t("broadcastPage.formTitle")}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.name")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                maxLength={200}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.messageType")}</label>
              <select
                value={messageType}
                onChange={(e) => setMessageType(e.target.value as "TEXT" | "TEMPLATE")}
                className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
              >
                <option value="TEMPLATE">{t("broadcastPage.typeTemplate")}</option>
                <option value="TEXT">{t("broadcastPage.typeText")}</option>
              </select>
            </div>
            <div>
              {messageType === "TEMPLATE" ? (
                <>
                  <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                    {t("broadcastPage.template")}
                  </label>
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                  >
                    <option value="">{t("broadcastPage.selectTemplate")}</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.body")}</label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950"
                    maxLength={4096}
                  />
                </>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">{t("broadcastPage.tags")}</label>
              <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-500">{t("broadcastPage.tagsHint")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const on = selectedTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        on
                          ? "border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100"
                          : "border-ink-200 text-ink-600 hover:border-ink-300 dark:border-ink-600 dark:text-ink-300",
                      )}
                      style={on ? { borderColor: tag.color } : undefined}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">
                {previewBusy
                  ? t("broadcastPage.previewLoading")
                  : previewCount !== null
                    ? t("broadcastPage.audiencePreview").replace("{count}", String(previewCount))
                    : t("broadcastPage.audienceEmpty")}
              </p>
            </div>
          </div>
          {formError ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleCreate()}
              className="btn-primary"
            >
              {submitting ? t("common.saving") : t("broadcastPage.saveDraft")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900">
        {loading ? (
          <p className="p-6 text-sm text-ink-500">{t("common.loading")}</p>
        ) : listError ? (
          <p className="p-6 text-sm text-red-600" role="alert">
            {listError}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-ink-500">{t("broadcastPage.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-ink-200 bg-ink-50 text-xs font-semibold uppercase text-ink-500 dark:border-ink-700 dark:bg-ink-800/80 dark:text-ink-400">
                <tr>
                  <th className="px-4 py-3">{t("broadcastPage.name")}</th>
                  <th className="px-4 py-3">{t("broadcastPage.colStatus")}</th>
                  <th className="px-4 py-3">{t("broadcastPage.colMessage")}</th>
                  <th className="px-4 py-3">{t("broadcastPage.colTags")}</th>
                  <th className="px-4 py-3">{t("broadcastPage.colStats")}</th>
                  <th className="px-4 py-3">{t("broadcastPage.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {rows.map((r) => (
                  <tr key={r.id} className="text-ink-800 dark:text-ink-200">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          r.status === "DRAFT" && "bg-ink-100 text-ink-700 dark:bg-ink-800",
                          r.status === "RUNNING" && "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
                          r.status === "COMPLETED" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
                        )}
                      >
                        {statusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.messageType === "TEMPLATE" ? t("broadcastPage.typeTemplate") : t("broadcastPage.typeText")}
                    </td>
                    <td className="max-w-[200px] px-4 py-3 text-xs text-ink-600 dark:text-ink-400">
                      <span className="line-clamp-2">
                        {r.tags?.map((x) => x.tag?.name).filter(Boolean).join(", ") || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {r.status === "DRAFT"
                        ? "—"
                        : `${r.sentCount}/${r.totalRecipients} · ${t("broadcastPage.failed")} ${r.failedCount}`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.status === "DRAFT" ? (
                          <>
                            <button
                              type="button"
                              disabled={actionBusy === r.id}
                              onClick={() => void startCampaign(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 dark:border-brand-700 dark:bg-brand-950/50 dark:text-brand-200"
                            >
                              <Play className="h-3.5 w-3.5" />
                              {t("broadcastPage.start")}
                            </button>
                            <button
                              type="button"
                              disabled={actionBusy === r.id}
                              onClick={() => void deleteDraft(r.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50 dark:border-ink-600 dark:hover:bg-ink-800"
                              aria-label={t("broadcastPage.delete")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[10px] text-ink-400">
                        {format(new Date(r.createdAt), "PPp", { locale: dateLocale })}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-ink-500 dark:text-ink-500">{t("broadcastPage.footnote")}</p>
    </div>
  );
}
