import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

export interface CannedResponseRow {
  id: string;
  shortcut: string;
  content: string;
}

interface CannedForm {
  shortcut: string;
  content: string;
}

function emptyForm(): CannedForm {
  return { shortcut: "", content: "" };
}

export function CannedResponsesSettings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<CannedResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CannedForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get<CannedResponseRow[]>("/canned-responses");
      setRows(list);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setError("");
    setModalOpen(true);
  };

  const openEdit = (row: CannedResponseRow) => {
    setEditingId(row.id);
    setForm({ shortcut: row.shortcut, content: row.content });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setError("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.shortcut.trim() || !form.content.trim()) return;
    setSaving(true);
    setError("");
    const payload = { shortcut: form.shortcut.trim(), content: form.content.trim() };
    try {
      if (editingId) {
        await api.put(`/canned-responses/${editingId}`, payload);
      } else {
        await api.post("/canned-responses", payload);
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.cannedSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm(t("settings.cannedDeleteConfirm"))) return;
    try {
      await api.delete(`/canned-responses/${id}`);
      await load();
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <CannedResponsesHeader t={t} openCreate={openCreate} />
        {loading ? (
          <p className="text-sm text-gray-500">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">{t("settings.cannedEmpty")}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium text-brand-700">/{row.shortcut}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600">{row.content}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="rounded-lg p-2 text-gray-600 hover:bg-gray-100"
                    title={t("common.edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(row.id)}
                    className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                    title={t("common.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={closeModal}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-500 hover:bg-gray-100"
              aria-label={t("common.close")}
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="pr-8 text-lg font-semibold text-gray-900">
              {editingId ? t("settings.cannedEditTitle") : t("settings.cannedAddTitle")}
            </h3>
            <p className="mt-1 text-sm text-gray-500">{t("settings.cannedModalSubtitle")}</p>
            <form onSubmit={(e) => void onSubmit(e)} className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">{t("settings.cannedShortcut")}</label>
                <div className="mt-1 flex rounded-lg border border-gray-300 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
                  <span className="flex items-center pl-3 text-sm text-gray-500">/</span>
                  <input
                    value={form.shortcut}
                    onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value.replace(/\s+/g, "") }))}
                    placeholder={t("settings.cannedShortcutPlaceholder")}
                    className="flex-1 border-0 bg-transparent py-2 pr-3 text-sm focus:outline-none focus:ring-0"
                    required
                  />
                </div>
              </div>
              <CannedMessageField form={form} setForm={setForm} t={t} />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.shortcut.trim() || !form.content.trim()}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {saving ? t("common.saving") : editingId ? t("common.save") : t("settings.cannedSubmit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CannedResponsesHeader({ t, openCreate }: { t: (k: string) => string; openCreate: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
          <MessageSquare className="h-5 w-5" />
          {t("settings.sectionCanned")}
        </h2>
        <p className="mt-1 text-sm text-gray-500">{t("settings.cannedIntro")}</p>
      </div>
      <button
        type="button"
        onClick={openCreate}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
      >
        <Plus className="h-4 w-4" />
        {t("settings.cannedAdd")}
      </button>
    </div>
  );
}

function CannedMessageField({
  form,
  setForm,
  t,
}: {
  form: CannedForm;
  setForm: React.Dispatch<React.SetStateAction<CannedForm>>;
  t: (k: string) => string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{t("settings.cannedMessage")}</label>
      <textarea
        value={form.content}
        onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
        rows={5}
        placeholder={t("settings.cannedMessagePlaceholder")}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        required
      />
    </div>
  );
}
