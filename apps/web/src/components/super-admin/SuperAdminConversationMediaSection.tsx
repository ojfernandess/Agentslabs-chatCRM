import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  SuperAdminMetricCard,
  SuperAdminPageHeader,
  SuperAdminPanel,
} from "@/components/super-admin/SuperAdminShell";
import clsx from "clsx";
import { ExternalLink, FileText, ImageIcon, RefreshCw, Trash2 } from "lucide-react";

type StorageKind = "local" | "minio" | "both" | "db_only";

type ConversationMediaItem = {
  filename: string;
  mediaUrl: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  storage: { local: boolean; minio: boolean };
  storageKind: StorageKind;
  referencedInDb: boolean;
  referenceCount: number;
  messageTypes: string[];
  organizations: { id: string; name: string }[];
  sources: ("conversation" | "team_channel")[];
  lastUsedAt: string | null;
};

type MediaPage = {
  data: ConversationMediaItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type MediaStats = {
  totalFiles: number;
  referencedInDb: number;
  localCount: number;
  minioCount: number;
  bothCount: number;
  dbOnlyCount: number;
  totalBytes: number;
  activeDriver: string;
  localDir: string;
  publicOrigin: string;
};

function formatBytes(bytes: number | null | undefined, t: (k: string) => string): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t("superAdmin.conversationMedia.kb")}`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${t("superAdmin.conversationMedia.mb")}`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ${t("superAdmin.conversationMedia.gb")}`;
}

function isImageItem(item: ConversationMediaItem): boolean {
  if (item.contentType?.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(item.filename);
}

export function SuperAdminConversationMediaSection() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [storage, setStorage] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [data, setData] = useState<MediaPage | null>(null);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ConversationMediaItem | null>(null);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await api.get<MediaStats>("/super/conversation-media/stats");
      setStats(res);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
      });
      const trimmed = q.trim();
      if (trimmed) params.set("q", trimmed);
      if (storage !== "all") params.set("storage", storage);
      if (typeFilter) params.set("type", typeFilter);
      const res = await api.get<MediaPage>(`/super/conversation-media?${params.toString()}`);
      setData(res);
      setSelected(new Set());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : t("superAdmin.conversationMedia.loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, q, storage, typeFilter, t]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const allSelectedOnPage = useMemo(() => {
    if (!data?.data.length) return false;
    return data.data.every((item) => selected.has(item.filename));
  }, [data, selected]);

  const toggleAllOnPage = () => {
    if (!data) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) {
        for (const item of data.data) next.delete(item.filename);
      } else {
        for (const item of data.data) next.add(item.filename);
      }
      return next;
    });
  };

  const toggleOne = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const refreshAll = async () => {
    await Promise.all([fetchStats(), fetchList()]);
  };

  const deleteFilenames = async (filenames: string[]) => {
    if (filenames.length === 0) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.post<{ deleted: string[]; clearedDbReferences: number; errors?: { filename: string; message: string }[] }>(
        "/super/conversation-media/bulk-delete",
        { filenames },
      );
      if (result.deleted.length === 0 && result.clearedDbReferences === 0) {
        throw new Error(
          result.errors?.[0]?.message ?? t("superAdmin.conversationMedia.deleteError"),
        );
      }
      if (result.errors?.length) {
        setError(result.errors.map((e) => `${e.filename}: ${e.message}`).join("; "));
      }
      setSuccess(
        t("superAdmin.conversationMedia.deleteSuccess")
          .replace("{files}", String(result.deleted.length))
          .replace("{refs}", String(result.clearedDbReferences)),
      );
      setDeleteTarget(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("superAdmin.conversationMedia.deleteError"));
    } finally {
      setBusy(false);
    }
  };

  const storageLabel = (item: ConversationMediaItem) => {
    switch (item.storageKind) {
      case "both":
        return t("superAdmin.conversationMedia.storageBoth");
      case "local":
        return t("superAdmin.conversationMedia.storageLocal");
      case "minio":
        return t("superAdmin.conversationMedia.storageMinio");
      case "db_only":
        return t("superAdmin.conversationMedia.storageDbOnly");
      default:
        return "—";
    }
  };

  return (
    <div className="space-y-6">
      <SuperAdminPageHeader
        title={t("superAdmin.conversationMedia.title")}
        subtitle={t("superAdmin.conversationMedia.subtitle")}
        actions={
          <button
            type="button"
            disabled={loading || statsLoading || busy}
            onClick={() => void refreshAll()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={clsx("h-4 w-4", (loading || statsLoading) && "animate-spin")} />
            {t("superAdmin.conversationMedia.refresh")}
          </button>
        }
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {statsLoading || !stats ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SuperAdminMetricCard
              label={t("superAdmin.conversationMedia.statTotal")}
              value={stats.totalFiles}
              accent="violet"
            />
            <SuperAdminMetricCard
              label={t("superAdmin.conversationMedia.statLocal")}
              value={stats.localCount}
              accent="emerald"
            />
            <SuperAdminMetricCard
              label={t("superAdmin.conversationMedia.statMinio")}
              value={stats.minioCount}
              accent="sky"
            />
            <SuperAdminMetricCard
              label={t("superAdmin.conversationMedia.statSize")}
              value={formatBytes(stats.totalBytes, t)}
              accent="amber"
            />
          </div>
          <p className="text-xs text-slate-500">
            {t("superAdmin.conversationMedia.driverHint")
              .replace("{driver}", stats.activeDriver)
              .replace("{dir}", stats.localDir)}
          </p>
        </>
      )}

      <SuperAdminPanel className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
            {t("superAdmin.conversationMedia.search")}
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder={t("superAdmin.conversationMedia.searchPlaceholder")}
              className="input-field"
            />
          </label>
          <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-slate-600">
            {t("superAdmin.conversationMedia.filterStorage")}
            <select
              value={storage}
              onChange={(e) => {
                setStorage(e.target.value);
                setPage(1);
              }}
              className="input-field"
            >
              <option value="all">{t("superAdmin.conversationMedia.filterAll")}</option>
              <option value="local">{t("superAdmin.conversationMedia.storageLocal")}</option>
              <option value="minio">{t("superAdmin.conversationMedia.storageMinio")}</option>
              <option value="both">{t("superAdmin.conversationMedia.storageBoth")}</option>
              <option value="db_only">{t("superAdmin.conversationMedia.storageDbOnly")}</option>
            </select>
          </label>
          <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-slate-600">
            {t("superAdmin.conversationMedia.filterType")}
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="input-field"
            >
              <option value="">{t("superAdmin.conversationMedia.filterAll")}</option>
              <option value="IMAGE">IMAGE</option>
              <option value="DOCUMENT">DOCUMENT</option>
              <option value="AUDIO">AUDIO</option>
              <option value="VIDEO">VIDEO</option>
              <option value="ATTACHMENT">ATTACHMENT</option>
            </select>
          </label>
          {selected.size > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    t("superAdmin.conversationMedia.bulkDeleteConfirm").replace("{count}", String(selected.size)),
                  )
                ) {
                  void deleteFilenames([...selected]);
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t("superAdmin.conversationMedia.deleteSelected").replace("{count}", String(selected.size))}
            </button>
          ) : null}
        </div>
      </SuperAdminPanel>

      {loading || !data ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : (
        <>
          <SuperAdminPanel className="overflow-x-auto p-0">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelectedOnPage}
                      onChange={toggleAllOnPage}
                      aria-label={t("superAdmin.conversationMedia.selectAllPage")}
                    />
                  </th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colPreview")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colFile")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colStorage")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colType")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colSize")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colRefs")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colOrgs")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colUsed")}</th>
                  <th className="px-3 py-2">{t("superAdmin.conversationMedia.colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      {t("superAdmin.conversationMedia.empty")}
                    </td>
                  </tr>
                ) : (
                  data.data.map((item) => (
                    <tr key={item.filename} className="align-top">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(item.filename)}
                          onChange={() => toggleOne(item.filename)}
                          aria-label={item.filename}
                        />
                      </td>
                      <td className="px-3 py-3">
                        {item.mediaUrl && isImageItem(item) ? (
                          <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="block">
                            <img
                              src={item.mediaUrl}
                              alt=""
                              className="h-12 w-12 rounded-md border border-slate-200 object-cover"
                            />
                          </a>
                        ) : (
                          <span className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400">
                            {isImageItem(item) ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="max-w-[220px] break-all font-mono text-xs text-slate-800">{item.filename}</p>
                        {item.mediaUrl ? (
                          <a
                            href={item.mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-xs text-violet-700 hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {t("superAdmin.conversationMedia.openFile")}
                          </a>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={clsx(
                            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            item.storageKind === "db_only" && "bg-amber-100 text-amber-900",
                            item.storageKind === "local" && "bg-emerald-100 text-emerald-900",
                            item.storageKind === "minio" && "bg-sky-100 text-sky-900",
                            item.storageKind === "both" && "bg-violet-100 text-violet-900",
                          )}
                        >
                          {storageLabel(item)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-700">
                        {item.messageTypes.length ? item.messageTypes.join(", ") : item.contentType ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-700">{formatBytes(item.sizeBytes, t)}</td>
                      <td className="px-3 py-3 text-xs text-slate-700">
                        {item.referenceCount}
                        {!item.referencedInDb ? (
                          <span className="ml-1 text-amber-700">({t("superAdmin.conversationMedia.orphan")})</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-700">
                        {item.organizations.length
                          ? item.organizations.map((o) => o.name).join(", ")
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                        {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeleteTarget(item)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("superAdmin.conversationMedia.deleteOne")}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </SuperAdminPanel>

          <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
            <span>
              {t("superAdmin.page")} {data.page} / {data.totalPages} · {data.total}{" "}
              {t("superAdmin.conversationMedia.files")}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={data.page <= 1 || busy}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("superAdmin.prev")}
              </button>
              <button
                type="button"
                disabled={data.page >= data.totalPages || busy}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
              >
                {t("superAdmin.next")}
              </button>
            </div>
          </div>
        </>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 className="text-lg font-semibold text-slate-900">{t("superAdmin.conversationMedia.deleteTitle")}</h3>
            <p className="mt-2 text-sm text-slate-600">
              {t("superAdmin.conversationMedia.deleteConfirm").replace("{name}", deleteTarget.filename)}
            </p>
            <p className="mt-2 text-xs text-slate-500">{t("superAdmin.conversationMedia.deleteHint")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteFilenames([deleteTarget.filename])}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? t("common.saving") : t("superAdmin.conversationMedia.deleteOne")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
