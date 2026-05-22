import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Clock, Pencil, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { slaDisplayFromMinutes } from "@/lib/slaTime";
import {
  settingsCard,
  settingsInput,
  settingsListWrap,
  settingsMuted,
  settingsTitle,
} from "@/components/settings/settingsUi";

export interface SlaPolicyRow {
  id: string;
  name: string;
  description: string | null;
  firstResponseTimeMinutes: number;
  nextResponseTimeMinutes: number;
  resolutionTimeMinutes: number;
  onlyDuringBusinessHours: boolean;
}

type TimeUnit = "minutes" | "hours" | "days";

interface TimeFields {
  value: number;
  unit: TimeUnit;
}

interface SlaForm {
  name: string;
  description: string;
  first: TimeFields;
  next: TimeFields;
  resolution: TimeFields;
  businessHours: boolean;
}

function emptyForm(): SlaForm {
  return {
    name: "",
    description: "",
    first: { value: 5, unit: "minutes" },
    next: { value: 5, unit: "minutes" },
    resolution: { value: 60, unit: "minutes" },
    businessHours: false,
  };
}

function formFromRow(row: SlaPolicyRow): SlaForm {
  const first = slaDisplayFromMinutes(row.firstResponseTimeMinutes);
  const next = slaDisplayFromMinutes(row.nextResponseTimeMinutes);
  const resolution = slaDisplayFromMinutes(row.resolutionTimeMinutes);
  return {
    name: row.name,
    description: row.description ?? "",
    first: { value: first.n, unit: first.u },
    next: { value: next.n, unit: next.u },
    resolution: { value: resolution.n, unit: resolution.u },
    businessHours: row.onlyDuringBusinessHours,
  };
}

function SlaTimeField({
  label,
  fields,
  onChange,
}: {
  label: string;
  fields: TimeFields;
  onChange: (f: TimeFields) => void;
}) {
  const { t } = useI18n();
  return (
    <div>
      <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{label}</label>
      <SlaTimeFieldInputs fields={fields} onChange={onChange} t={t} />
    </div>
  );
}

function SlaTimeFieldInputs({
  fields,
  onChange,
  t,
}: {
  fields: TimeFields;
  onChange: (f: TimeFields) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="mt-1 flex gap-2">
      <input
        type="number"
        min={1}
        value={fields.value}
        onChange={(e) => onChange({ ...fields, value: Number(e.target.value) || 1 })}
        className="input-field w-24"
      />
      <select
        value={fields.unit}
        onChange={(e) => onChange({ ...fields, unit: e.target.value as TimeUnit })}
        className="input-field flex-1"
      >
        <option value="minutes">{t("settings.workflowUnitMinutes")}</option>
        <option value="hours">{t("settings.workflowUnitHours")}</option>
        <option value="days">{t("settings.workflowUnitDays")}</option>
      </select>
    </div>
  );
}

function SlaPolicyModal({
  t,
  editingId,
  form,
  setForm,
  saving,
  error,
  closeModal,
  onSubmit,
}: {
  t: (k: string) => string;
  editingId: string | null;
  form: SlaForm;
  setForm: React.Dispatch<React.SetStateAction<SlaForm>>;
  saving: boolean;
  error: string;
  closeModal: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={closeModal}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-ink-200/80 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-[#111C2B]"
        role="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={closeModal}
          className="absolute right-4 top-4 rounded-lg p-1 text-ink-500 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-white/10"
          aria-label={t("common.close")}
        >
          <X className="h-5 w-5" />
        </button>
        <h3 className="pr-8 text-lg font-semibold text-ink-900 dark:text-ink-50">
          {editingId ? t("settings.slaEditTitle") : t("settings.slaAddTitle")}
        </h3>
        <p className={`mt-1 ${settingsMuted}`}>{t("settings.slaModalSubtitle")}</p>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.slaName")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t("settings.slaNamePlaceholder")}
              className={settingsInput}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("settings.slaDescription")}</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t("settings.slaDescriptionPlaceholder")}
              className={settingsInput}
            />
          </div>
          <SlaTimeField
            label={t("settings.slaFirstResponse")}
            fields={form.first}
            onChange={(first) => setForm((f) => ({ ...f, first }))}
          />
          <SlaTimeField
            label={t("settings.slaNextResponse")}
            fields={form.next}
            onChange={(next) => setForm((f) => ({ ...f, next }))}
          />
          <SlaTimeField
            label={t("settings.slaResolution")}
            fields={form.resolution}
            onChange={(resolution) => setForm((f) => ({ ...f, resolution }))}
          />
          <label className="flex items-center justify-between gap-3 rounded-lg border border-ink-200/80 px-3 py-3 dark:border-white/10">
            <span className="text-sm text-ink-700 dark:text-ink-300">{t("settings.slaBusinessHours")}</span>
            <input
              type="checkbox"
              checked={form.businessHours}
              onChange={(e) => setForm((f) => ({ ...f, businessHours: e.target.checked }))}
              className="h-4 w-4 rounded border-ink-300 text-brand-500 dark:border-ink-600"
            />
          </label>
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? t("common.saving") : editingId ? t("common.save") : t("settings.slaCreate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SlaPoliciesSettings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<SlaPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SlaForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get<SlaPolicyRow[]>("/sla-policies");
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

  const openEdit = (row: SlaPolicyRow) => {
    setEditingId(row.id);
    setForm(formFromRow(row));
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setError("");
  };

  const formatDuration = (minutes: number) => {
    const d = slaDisplayFromMinutes(minutes);
    const unitKey =
      d.u === "days"
        ? "settings.slaUnitDaysShort"
        : d.u === "hours"
          ? "settings.slaUnitHoursShort"
          : "settings.slaUnitMinutesShort";
    return `${d.n} ${t(unitKey)}`;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      firstResponseTime: { value: form.first.value, unit: form.first.unit },
      nextResponseTime: { value: form.next.value, unit: form.next.unit },
      resolutionTime: { value: form.resolution.value, unit: form.resolution.unit },
      onlyDuringBusinessHours: form.businessHours,
    };
    try {
      if (editingId) {
        await api.put(`/sla-policies/${editingId}`, payload);
      } else {
        await api.post("/sla-policies", payload);
      }
      closeModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.slaSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm(t("settings.slaDeleteConfirm"))) return;
    try {
      await api.delete(`/sla-policies/${id}`);
      await load();
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className={settingsCard}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={`flex items-center gap-2 ${settingsTitle}`}>
              <Clock className="h-5 w-5" />
              {t("settings.sectionSla")}
            </h2>
            <p className={`mt-1 ${settingsMuted}`}>{t("settings.slaIntro")}</p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            <Plus className="h-4 w-4" />
            {t("settings.slaAdd")}
          </button>
        </div>
        {loading ? (
          <p className={settingsMuted}>{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className={settingsMuted}>{t("settings.slaEmpty")}</p>
        ) : (
          <ul className={settingsListWrap}>
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink-900 dark:text-ink-50">{row.name}</p>
                  {row.description ? <p className={`mt-0.5 text-xs ${settingsMuted}`}>{row.description}</p> : null}
                  <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
                    {t("settings.slaListFirst")}: {formatDuration(row.firstResponseTimeMinutes)} ·{" "}
                    {t("settings.slaListNext")}: {formatDuration(row.nextResponseTimeMinutes)} ·{" "}
                    {t("settings.slaListResolution")}: {formatDuration(row.resolutionTimeMinutes)}
                    {row.onlyDuringBusinessHours ? ` · ${t("settings.slaBusinessHoursBadge")}` : ""}
                  </p>
                </div>
                <SlaPoliciesRowActions row={row} openEdit={openEdit} onDelete={onDelete} t={t} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {modalOpen ? (
        <SlaPolicyModal
          t={t}
          editingId={editingId}
          form={form}
          setForm={setForm}
          saving={saving}
          error={error}
          closeModal={closeModal}
          onSubmit={onSubmit}
        />
      ) : null}
    </>
  );
}

function SlaPoliciesRowActions({
  row,
  openEdit,
  onDelete,
  t,
}: {
  row: SlaPolicyRow;
  openEdit: (row: SlaPolicyRow) => void;
  onDelete: (id: string) => void;
  t: (k: string) => string;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={() => openEdit(row)}
        className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-white/10"
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
  );
}
