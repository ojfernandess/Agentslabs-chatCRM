import { useState, useEffect, useMemo, useCallback, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import {
  LayoutGrid,
  Search,
  Phone,
  GripVertical,
  User,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import {
  PageTransition,
  motion,
  staggerContainer,
  staggerItem,
} from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { filterTagsForDisplay } from "@/lib/tagDisplay";

const UNASSIGNED_KEY = "__unassigned__";
const DND_MIME = "application/x-openconduit-contact-id";

interface StageItem {
  id: string;
  name: string;
  order: number;
  color: string;
}

interface BoardContact {
  id: string;
  name: string;
  phone: string;
  updatedAt: string;
  tags: { tag: { id: string; name: string; color: string } }[];
  pipelineStage: (StageItem & { leadTypeId?: string | null }) | null;
  assignedTo: { id: string; name: string } | null;
}

interface BoardPayload {
  stages: StageItem[];
  contacts: BoardContact[];
}

interface ColumnDef {
  key: string;
  name: string;
  color: string;
  /** Lead type id (cols come from Tipos de lead). */
  leadTypeId: string | null;
}

export function CrmKanbanPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api.get<BoardPayload>("/pipeline/board");
      setBoard(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setLoadError(t("crm.kanbanDisabled"));
      } else {
        setLoadError(t("crm.loadError"));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    const clearDragOver = () => setDragOverColumn(null);
    window.addEventListener("dragend", clearDragOver);
    return () => window.removeEventListener("dragend", clearDragOver);
  }, []);

  const columns: ColumnDef[] = useMemo(() => {
    const unassigned: ColumnDef = {
      key: UNASSIGNED_KEY,
      name: t("crm.noStage"),
      color: "#94a3b8",
      leadTypeId: null,
    };
    if (!board) return [unassigned];
    const stageCols = [...board.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        key: s.id,
        name: s.name,
        color: s.color,
        leadTypeId: s.id,
      }));
    return [unassigned, ...stageCols];
  }, [board, t]);

  const filteredContacts = useMemo(() => {
    if (!board) return [];
    const q = search.trim().toLowerCase();
    if (!q) return board.contacts;
    return board.contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q),
    );
  }, [board, search]);

  const contactsByColumn = useMemo(() => {
    const map = new Map<string, BoardContact[]>();
    for (const c of filteredContacts) {
      const key = c.pipelineStage?.leadTypeId ?? UNASSIGNED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [filteredContacts]);

  const onCardDragStart = (e: DragEvent, contactId: string) => {
    e.dataTransfer.setData(DND_MIME, contactId);
    e.dataTransfer.setData("text/plain", contactId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onColumnDragOver = (e: DragEvent, columnKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnKey);
  };

  const onColumnDrop = async (e: DragEvent, leadTypeId: string | null) => {
    e.preventDefault();
    setDragOverColumn(null);
    const contactId =
      e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
    if (!contactId || !board) return;

    const contact = board.contacts.find((c) => c.id === contactId);
    const currentLeadTypeId = contact?.pipelineStage?.leadTypeId ?? null;
    if (currentLeadTypeId === leadTypeId) return;

    setMovingId(contactId);
    try {
      const updated = await api.put<{ pipelineStage: BoardContact["pipelineStage"] }>(
        `/contacts/${contactId}/stage`,
        { leadTypeId },
      );
      setBoard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          contacts: prev.contacts.map((c) =>
            c.id === contactId
              ? {
                  ...c,
                  pipelineStage: updated.pipelineStage,
                }
              : c,
          ),
        };
      });
    } catch {
      await loadBoard();
    } finally {
      setMovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="flex h-full flex-col bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-8 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <LayoutGrid className="h-7 w-7 text-brand-600" />
                {t("crm.title")}
              </h1>
              <p className="mt-1 text-sm text-gray-500">{t("crm.subtitle")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1 lg:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("crm.searchPlaceholder")}
                  className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              {isAdmin && (
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  <Settings className="h-4 w-4" />
                  {t("settings.leadTypesTitle")}
                </Link>
              )}
            </div>
          </div>
          {loadError && (
            <p className="mt-3 text-sm text-red-600">{loadError}</p>
          )}
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
          <motion.div
            className="flex h-full min-h-[calc(100vh-12rem)] gap-4"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {columns.map((col) => {
              const cards = contactsByColumn.get(col.key) ?? [];
              const isOver = dragOverColumn === col.key;
              return (
                <motion.div
                  key={col.key}
                  variants={staggerItem}
                  className={clsx(
                    "flex w-72 shrink-0 flex-col rounded-xl border-2 bg-white shadow-sm transition-colors",
                    isOver ? "border-brand-400 bg-brand-50/30" : "border-gray-200",
                  )}
                  onDragOver={(e) => onColumnDragOver(e, col.key)}
                  onDrop={(e) => onColumnDrop(e, col.leadTypeId)}
                >
                  <div
                    className="flex items-start justify-between gap-2 border-b border-gray-100 px-3 py-3"
                    style={{ borderTop: `3px solid ${col.color}` }}
                  >
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-gray-900">{col.name}</h2>
                      <p className="text-xs text-gray-500">
                        {cards.length} {t("crm.contacts")}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto p-3">
                    {cards.length === 0 ? (
                      <p className="py-8 text-center text-xs text-gray-400">{t("crm.dropHere")}</p>
                    ) : (
                      cards.map((c) => {
                        const visibleTags = filterTagsForDisplay(c.tags);
                        return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={(e) => onCardDragStart(e, c.id)}
                          className={clsx(
                            "group cursor-grab rounded-lg border border-gray-200 bg-white p-3 shadow-sm active:cursor-grabbing",
                            movingId === c.id && "opacity-50",
                          )}
                        >
                          <div className="flex gap-2">
                            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-400" />
                            <div className="min-w-0 flex-1">
                              <Link
                                to={`/contacts/${c.id}`}
                                className="font-medium text-gray-900 hover:text-brand-600"
                                onDragStart={(e) => e.preventDefault()}
                              >
                                {c.name}
                              </Link>
                              <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                                <Phone className="h-3 w-3" />
                                {c.phone}
                              </span>
                              {c.assignedTo && (
                                <span className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                                  <User className="h-3 w-3" />
                                  {c.assignedTo.name}
                                </span>
                              )}
                              {visibleTags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {visibleTags.slice(0, 3).map(({ tag }) => (
                                    <span
                                      key={tag.id}
                                      className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                                      style={{ backgroundColor: tag.color }}
                                    >
                                      {tag.name}
                                    </span>
                                  ))}
                                  {visibleTags.length > 3 && (
                                    <span className="text-[10px] text-gray-400">
                                      +{visibleTags.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </PageTransition>
  );
}
