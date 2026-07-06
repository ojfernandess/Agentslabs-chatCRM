import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import {
  BookOpen,
  ExternalLink,
  FileText,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Youtube,
  Zap,
  Pencil,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { getYouTubeEmbedUrl, isYouTubeUrl } from "@/lib/youtubeEmbed";

export type WorkspaceFilter = "NOTE" | "WIKI" | "SNIPPET" | "FILE_LINK" | "YOUTUBE";

export interface WorkspaceItem {
  id: string;
  itemType: WorkspaceFilter;
  title: string;
  content: string | null;
  fileUrl: string | null;
  pinned: boolean;
  updatedAt: string;
  createdBy: { id: string; name: string };
}

const TYPE_NAV: { id: WorkspaceFilter; icon: typeof StickyNote }[] = [
  { id: "NOTE", icon: StickyNote },
  { id: "WIKI", icon: BookOpen },
  { id: "SNIPPET", icon: Zap },
  { id: "FILE_LINK", icon: FileText },
  { id: "YOUTUBE", icon: Youtube },
];

function usesFileUrl(type: WorkspaceFilter): boolean {
  return type === "FILE_LINK" || type === "YOUTUBE";
}

function itemPreview(item: WorkspaceItem): string {
  if (item.itemType === "YOUTUBE" && item.fileUrl) return item.fileUrl;
  if (item.fileUrl) return item.fileUrl;
  if (item.content) return item.content.replace(/\s+/g, " ").trim();
  return "";
}

interface TeamWorkspacePanelProps {
  teamId: string;
  onMutated?: () => void;
}

export function TeamWorkspacePanel({ teamId, onMutated }: TeamWorkspacePanelProps) {
  const { t, dateLocale } = useI18n();

  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("NOTE");
  const [workspaceItems, setWorkspaceItems] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"view" | "create" | "edit">("view");
  const [busy, setBusy] = useState(false);

  const [wsTitle, setWsTitle] = useState("");
  const [wsContent, setWsContent] = useState("");
  const [wsFileUrl, setWsFileUrl] = useState("");

  const loadWorkspace = useCallback(
    async (filter: WorkspaceFilter) => {
      setLoading(true);
      try {
        const res = await api.get<{ data: WorkspaceItem[] }>(`/teams/${teamId}/workspace?type=${filter}`);
        setWorkspaceItems(res.data);
      } finally {
        setLoading(false);
      }
    },
    [teamId],
  );

  useEffect(() => {
    void loadWorkspace(workspaceFilter);
  }, [teamId, workspaceFilter, loadWorkspace]);

  useEffect(() => {
    setSelectedId(null);
    setPanelMode("view");
    setSearchQuery("");
    resetForm();
  }, [workspaceFilter, teamId]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return workspaceItems;
    return workspaceItems.filter((item) => {
      const hay = `${item.title} ${item.content ?? ""} ${item.fileUrl ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [workspaceItems, searchQuery]);

  const selectedItem = useMemo(
    () => workspaceItems.find((i) => i.id === selectedId) ?? null,
    [workspaceItems, selectedId],
  );

  const resetForm = () => {
    setWsTitle("");
    setWsContent("");
    setWsFileUrl("");
  };

  const startCreate = () => {
    resetForm();
    setSelectedId(null);
    setPanelMode("create");
  };

  const startEdit = (item: WorkspaceItem) => {
    setWsTitle(item.title);
    setWsContent(item.content ?? "");
    setWsFileUrl(item.fileUrl ?? "");
    setSelectedId(item.id);
    setPanelMode("edit");
  };

  const selectItem = (item: WorkspaceItem) => {
    setSelectedId(item.id);
    setPanelMode("view");
    resetForm();
  };

  const refresh = async () => {
    await loadWorkspace(workspaceFilter);
    onMutated?.();
  };

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    const title = wsTitle.trim();
    if (!title) return;

    if (workspaceFilter === "YOUTUBE") {
      const url = wsFileUrl.trim();
      if (!url || !isYouTubeUrl(url)) {
        window.alert(t("teamsHub.workspaceYoutubeInvalid"));
        return;
      }
    }

    setBusy(true);
    try {
      if (panelMode === "create") {
        await api.post(`/teams/${teamId}/workspace`, {
          itemType: workspaceFilter,
          title,
          content: usesFileUrl(workspaceFilter) ? undefined : wsContent.trim() || undefined,
          fileUrl: usesFileUrl(workspaceFilter) && wsFileUrl.trim() ? wsFileUrl.trim() : undefined,
        });
        resetForm();
        setPanelMode("view");
      } else if (panelMode === "edit" && selectedId) {
        await api.patch(`/teams/${teamId}/workspace/${selectedId}`, {
          title,
          content: usesFileUrl(workspaceFilter) ? null : wsContent.trim() || null,
          fileUrl: usesFileUrl(workspaceFilter) ? wsFileUrl.trim() || null : null,
        });
        setPanelMode("view");
      }
      await refresh();
    } catch {
      window.alert(t("teamsHub.workspaceSaveError"));
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (item: WorkspaceItem) => {
    if (!window.confirm(t("teamsHub.workspaceDeleteConfirm"))) return;
    setBusy(true);
    try {
      await api.delete(`/teams/${teamId}/workspace/${item.id}`);
      if (selectedId === item.id) {
        setSelectedId(null);
        setPanelMode("view");
      }
      await refresh();
    } catch {
      window.alert(t("teamsHub.workspaceDeleteError"));
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (item: WorkspaceItem) => {
    setBusy(true);
    try {
      await api.patch(`/teams/${teamId}/workspace/${item.id}`, { pinned: !item.pinned });
      await refresh();
    } catch {
      window.alert(t("teamsHub.workspaceSaveError"));
    } finally {
      setBusy(false);
    }
  };

  const urlPlaceholder =
    workspaceFilter === "YOUTUBE" ? t("teamsHub.youtubeUrl") : t("teamsHub.fileUrl");

  return (
    <div className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-[#f8f9fb] shadow-sm dark:border-ink-800 dark:bg-ink-950/40 lg:min-h-[560px] lg:flex-row">
      {/* Type sidebar — Slack sections */}
      <aside className="shrink-0 border-b border-ink-200/80 bg-white/95 p-2 dark:border-ink-800 dark:bg-ink-950/80 lg:w-[210px] lg:border-b-0 lg:border-r">
        <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          {t("teamsHub.workspaceNavLabel")}
        </p>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {TYPE_NAV.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setWorkspaceFilter(w.id)}
              className={clsx(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                workspaceFilter === w.id
                  ? "bg-[#1264a3]/12 text-[#1264a3] dark:bg-brand-500/20 dark:text-brand-100"
                  : "text-ink-600 hover:bg-ink-100/80 dark:text-ink-300 dark:hover:bg-ink-900",
              )}
            >
              <w.icon className="h-4 w-4 shrink-0" />
              {t(`teamsHub.workspace.${w.id}`)}
            </button>
          ))}
        </nav>
      </aside>

      {/* Item list — Slack channel list */}
      <section className="flex min-h-0 w-full flex-col border-b border-ink-200/80 bg-white dark:border-ink-800 dark:bg-ink-950/60 lg:w-[300px] lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2.5 dark:border-ink-800">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("teamsHub.workspaceSearch")}
              className="input-field w-full py-1.5 pl-8 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={startCreate}
            title={t("common.add")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1264a3] text-white transition hover:bg-[#0b4f82]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <li className="px-3 py-6 text-center text-sm text-ink-500">{t("common.loading")}</li>
          ) : filteredItems.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-500">{t("teamsHub.workspaceEmpty")}</li>
          ) : (
            filteredItems.map((item) => {
              const preview = itemPreview(item);
              const isActive = selectedId === item.id && panelMode !== "create";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => selectItem(item)}
                    className={clsx(
                      "group w-full rounded-lg px-3 py-2.5 text-left transition",
                      isActive
                        ? "bg-[#1264a3]/10 ring-1 ring-[#1264a3]/25 dark:bg-brand-500/15"
                        : "hover:bg-ink-50 dark:hover:bg-ink-900/60",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {item.pinned ? (
                        <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      ) : (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-300 dark:bg-ink-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink-900 dark:text-ink-50">{item.title}</p>
                        {preview ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{preview}</p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-ink-400">
                          {item.createdBy.name} ·{" "}
                          {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true, locale: dateLocale })}
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </section>

      {/* Detail / editor — HubSpot knowledge panel */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-ink-950/40">
        {panelMode === "create" || panelMode === "edit" ? (
          <form onSubmit={submitForm} className="flex min-h-0 flex-1 flex-col p-5">
            <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50">
              {panelMode === "create" ? t("teamsHub.workspaceNew") : t("teamsHub.workspaceEdit")}
            </h3>
            <p className="mt-1 text-xs text-ink-500">{t(`teamsHub.workspace.${workspaceFilter}`)}</p>
            <input
              value={wsTitle}
              onChange={(e) => setWsTitle(e.target.value)}
              placeholder={t("teamsHub.workspaceTitle")}
              className="input-field mt-4 w-full"
              autoFocus
            />
            {usesFileUrl(workspaceFilter) ? (
              <input
                value={wsFileUrl}
                onChange={(e) => setWsFileUrl(e.target.value)}
                placeholder={urlPlaceholder}
                className="input-field mt-3 w-full"
              />
            ) : (
              <textarea
                value={wsContent}
                onChange={(e) => setWsContent(e.target.value)}
                rows={10}
                placeholder={t("teamsHub.workspaceBody")}
                className="input-field mt-3 min-h-[200px] w-full flex-1 resize-y"
              />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" disabled={busy || !wsTitle.trim()} className="btn-primary text-sm">
                {busy ? t("common.saving") : panelMode === "create" ? t("common.add") : t("common.save")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (panelMode === "edit" && selectedItem) {
                    setPanelMode("view");
                  } else {
                    setPanelMode("view");
                    resetForm();
                  }
                }}
                className="btn-secondary text-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        ) : selectedItem ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-800">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {selectedItem.pinned ? <Pin className="h-4 w-4 shrink-0 text-amber-500" /> : null}
                  <h3 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{selectedItem.title}</h3>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {selectedItem.createdBy.name} ·{" "}
                  {formatDistanceToNow(new Date(selectedItem.updatedAt), { addSuffix: true, locale: dateLocale })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void togglePin(selectedItem)}
                  title={selectedItem.pinned ? t("teamsHub.workspaceUnpin") : t("teamsHub.workspacePin")}
                  className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-900"
                >
                  {selectedItem.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startEdit(selectedItem)}
                  title={t("common.edit")}
                  className="rounded-lg p-2 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-900"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteItem(selectedItem)}
                  title={t("common.delete")}
                  className="rounded-lg p-2 text-ink-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {selectedItem.itemType === "YOUTUBE" && selectedItem.fileUrl ? (
                <YouTubeEmbed url={selectedItem.fileUrl} />
              ) : selectedItem.fileUrl ? (
                <a
                  href={selectedItem.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1264a3] underline-offset-2 hover:underline"
                >
                  {selectedItem.fileUrl}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <div className="prose prose-sm max-w-none whitespace-pre-wrap text-ink-700 dark:prose-invert dark:text-ink-200">
                  {selectedItem.content}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="rounded-2xl bg-ink-100/80 p-4 dark:bg-ink-900/60">
              {(() => {
                const nav = TYPE_NAV.find((n) => n.id === workspaceFilter);
                const Icon = nav?.icon ?? StickyNote;
                return <Icon className="h-8 w-8 text-ink-400" />;
              })()}
            </div>
            <p className="max-w-xs text-sm text-ink-500">{t("teamsHub.workspaceSelectHint")}</p>
            <button type="button" onClick={startCreate} className="btn-primary text-sm">
              <Plus className="mr-1.5 inline h-4 w-4" />
              {t("teamsHub.workspaceNew")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function YouTubeEmbed({ url }: { url: string }) {
  const embedUrl = getYouTubeEmbedUrl(url);
  if (!embedUrl) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 underline">
        {url}
      </a>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-black shadow-md dark:border-ink-700">
      <div className="relative aspect-video w-full">
        <iframe
          src={embedUrl}
          title="YouTube video"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}
