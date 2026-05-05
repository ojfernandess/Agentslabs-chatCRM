import { useState, useEffect, useMemo, useCallback, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import {
  LayoutGrid,
  Search,
  Phone,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  User,
} from "lucide-react";
import clsx from "clsx";
import {
  PageTransition,
  motion,
  AnimatePresence,
  staggerContainer,
  staggerItem,
  backdropVariants,
  modalVariants,
} from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";

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
  pipelineStage: StageItem | null;
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
  stageId: string | null;
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

  // Admin: stages
  const [showAddStage, setShowAddStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("#6366f1");
  const [stageFormError, setStageFormError] = useState("");

  const [editingStage, setEditingStage] = useState<StageItem | null>(null);
  const [editStageName, setEditStageName] = useState("");
  const [editStageColor, setEditStageColor] = useState("#6366f1");
  const [editStageOrder, setEditStageOrder] = useState(0);

  const [deletingStage, setDeletingStage] = useState<StageItem | null>(null);

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
      stageId: null,
    };
    if (!board) return [unassigned];
    const stageCols = [...board.stages]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        key: s.id,
        name: s.name,
        color: s.color,
        stageId: s.id,
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
      const key = c.pipelineStage?.id ?? UNASSIGNED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [filteredContacts]);

  const openEditStage = (s: StageItem) => {
    setEditingStage(s);
    setEditStageName(s.name);
    setEditStageColor(s.color);
    setEditStageOrder(s.order);
  };

  const handleAddStage = async () => {
    setStageFormError("");
    if (!board || !newStageName.trim()) return;
    const nextOrder =
      board.stages.length === 0
        ? 0
        : Math.max(...board.stages.map((s) => s.order)) + 1;
    try {
      await api.post<StageItem>("/pipeline/stages", {
        name: newStageName.trim(),
        order: nextOrder,
        color: newStageColor,
      });
      setNewStageName("");
      setNewStageColor("#6366f1");
      setShowAddStage(false);
      await loadBoard();
    } catch (err) {
      setStageFormError(err instanceof Error ? err.message : "Failed to create stage");
    }
  };

  const handleSaveStage = async () => {
    if (!editingStage) return;
    try {
      await api.put(`/pipeline/stages/${editingStage.id}`, {
        name: editStageName.trim(),
        order: editStageOrder,
        color: editStageColor,
      });
      setEditingStage(null);
      await loadBoard();
    } catch (err) {
      setStageFormError(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDeleteStage = async () => {
    if (!deletingStage) return;
    try {
      await api.delete(`/pipeline/stages/${deletingStage.id}`);
      setDeletingStage(null);
      await loadBoard();
    } catch {
      // failed
    }
  };

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

  const onColumnDrop = async (e: DragEvent, stageId: string | null) => {
    e.preventDefault();
    setDragOverColumn(null);
    const contactId =
      e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData("text/plain");
    if (!contactId || !board) return;

    const contact = board.contacts.find((c) => c.id === contactId);
    const currentStageId = contact?.pipelineStage?.id ?? null;
    if (currentStageId === stageId) return;

    setMovingId(contactId);
    try {
      const updated = await api.put<{ pipelineStage: StageItem | null }>(
        `/contacts/${contactId}/stage`,
        { stageId },
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
                <motion.button
                  type="button"
                  onClick={() => {
                    setStageFormError("");
                    setShowAddStage(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
                  whileTap={{ scale: 0.97 }}
                >
                  <Plus className="h-4 w-4" />
                  {t("crm.addColumn")}
                </motion.button>
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
                  onDrop={(e) => onColumnDrop(e, col.stageId)}
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
                    {isAdmin && col.stageId && (
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            const s = board?.stages.find((x) => x.id === col.stageId);
                            if (s) openEditStage(s);
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title="Edit column"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeletingStage(
                              board!.stages.find((s) => s.id === col.stageId) ?? null,
                            )
                          }
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete column"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto p-3">
                    {cards.length === 0 ? (
                      <p className="py-8 text-center text-xs text-gray-400">{t("crm.dropHere")}</p>
                    ) : (
                      cards.map((c) => (
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
                              {c.tags.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {c.tags.slice(0, 3).map(({ tag }) => (
                                    <span
                                      key={tag.id}
                                      className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                                      style={{ backgroundColor: tag.color }}
                                    >
                                      {tag.name}
                                    </span>
                                  ))}
                                  {c.tags.length > 3 && (
                                    <span className="text-[10px] text-gray-400">
                                      +{c.tags.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>

        {/* Add stage modal */}
        <AnimatePresence>
          {showAddStage && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              variants={backdropVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <motion.div
                className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
                variants={modalVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <h2 className="text-lg font-semibold text-gray-900">{t("crm.newColumnTitle")}</h2>
                {stageFormError && (
                  <p className="mt-2 text-sm text-red-600">{stageFormError}</p>
                )}
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t("crm.stageName")}</label>
                    <input
                      type="text"
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t("crm.color")}</label>
                    <input
                      type="color"
                      value={newStageColor}
                      onChange={(e) => setNewStageColor(e.target.value)}
                      className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-gray-300"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddStage(false);
                      setStageFormError("");
                    }}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {t("crm.create")}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Edit stage modal */}
        <AnimatePresence>
          {editingStage && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              variants={backdropVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <motion.div
                className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
                variants={modalVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <h2 className="text-lg font-semibold text-gray-900">{t("crm.editColumnTitle")}</h2>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t("crm.stageName")}</label>
                    <input
                      type="text"
                      value={editStageName}
                      onChange={(e) => setEditStageName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t("crm.order")}</label>
                    <input
                      type="number"
                      min={0}
                      value={editStageOrder}
                      onChange={(e) => setEditStageOrder(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">{t("crm.color")}</label>
                    <input
                      type="color"
                      value={editStageColor}
                      onChange={(e) => setEditStageColor(e.target.value)}
                      className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-gray-300"
                    />
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingStage(null)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveStage}
                    disabled={!editStageName.trim()}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {t("crm.save")}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete confirm */}
        <AnimatePresence>
          {deletingStage && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
              variants={backdropVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              <motion.div
                className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
                variants={modalVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <h2 className="text-lg font-semibold text-gray-900">{t("common.delete")}</h2>
                <p className="mt-2 text-sm text-gray-600">
                  <span className="font-medium">&quot;{deletingStage.name}&quot;</span>
                  {" — "}
                  {t("crm.deleteStageConfirm")}
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeletingStage(null)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteStage}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
