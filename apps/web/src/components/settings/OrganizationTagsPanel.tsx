import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Tag } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";

type TagRow = { id: string; name: string; color: string };

const DEFAULT_COLOR = "#6366f1";

export function OrganizationTagsPanel() {
  const { t } = useI18n();
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.get<TagRow[]>("/tags");
      setTags(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.tagsLoadError"));
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setColor(DEFAULT_COLOR);
  };

  const startEdit = (row: TagRow) => {
    setEditingId(row.id);
    setName(row.name);
    setColor(row.color);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (editingId) {
        await api.put(`/tags/${editingId}`, { name: trimmed, color });
      } else {
        await api.post("/tags", { name: trimmed, color });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.tagsSaveError"));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("settings.tagsDeleteConfirm"))) return;
    setError("");
    try {
      await api.delete(`/tags/${id}`);
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("settings.tagsDeleteError"));
    }
  };

  return (
    <div className="card-surface rounded-xl p-6">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-ink-900 dark:text-ink-50">
        <Tag className="h-5 w-5" />
        {t("settings.tagsTitle")}
      </h2>
      <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">{t("settings.tagsSubtitle")}</p>

      {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-ink-500">{t("common.loading")}</p>
      ) : tags.length > 0 ? (
        <div className="mb-6 overflow-x-auto rounded-lg border border-ink-200/80 dark:border-white/10">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-200/80 bg-ink-50 text-xs font-medium uppercase tracking-wide text-ink-500 dark:border-white/10 dark:bg-white/5">
                <th className="px-4 py-2">{t("settings.tagsColName")}</th>
                <th className="px-4 py-2">{t("settings.tagsColColor")}</th>
                <th className="px-4 py-2 text-right">{t("settings.tagsColActions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-white/10">
              {tags.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2.5 font-medium text-ink-900 dark:text-ink-100">{row.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2 text-ink-600 dark:text-ink-400">
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-ink-200"
                        style={{ backgroundColor: row.color }}
                        aria-hidden
                      />
                      {row.color}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      className="mr-2 text-xs font-medium text-brand-600 hover:underline"
                      onClick={() => startEdit(row)}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-red-600 hover:underline"
                      onClick={() => void handleDelete(row.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-4 text-sm text-ink-500">{t("settings.tagsEmpty")}</p>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 border-t border-ink-100 pt-4 dark:border-white/10">
        <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">
          {editingId ? t("settings.tagsFormEdit") : t("settings.tagsFormCreate")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.tagsColName")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              className="mt-1 block w-full input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.tagsColColor")}</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="mt-1 h-10 w-full cursor-pointer rounded border border-ink-200 dark:border-ink-600"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary">
            {editingId ? t("common.save") : t("common.add")}
          </button>
          {editingId ? (
            <button type="button" className="btn-secondary" onClick={resetForm}>
              {t("common.cancel")}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
