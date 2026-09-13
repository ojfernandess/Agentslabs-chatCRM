import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { allKnownActionIds, slugifyActionId, validateCustomActionId } from "@/lib/eil/categoryCatalog.js";
import type { EilCustomActionDef } from "@/lib/eil/types.js";

type Translate = (key: string) => string;

type Props = {
  open: boolean;
  initial?: EilCustomActionDef | null;
  existingCustomActions: EilCustomActionDef[];
  t: Translate;
  onClose: () => void;
  onSave: (action: EilCustomActionDef) => void;
};

export function EilCustomActionModal({ open, initial, existingCustomActions, t, onClose, onSave }: Props) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [idEdited, setIdEdited] = useState(false);

  useEffect(() => {
    if (open) {
      setLabel(initial?.label ?? "");
      setId(initial?.id ?? "");
      setDescription(initial?.description ?? "");
      setIdEdited(Boolean(initial?.id));
    }
  }, [open, initial]);

  const knownIds = useMemo(() => {
    const ids = allKnownActionIds();
    for (const c of existingCustomActions) {
      if (initial && c.id === initial.id) continue;
      ids.add(c.id);
    }
    return ids;
  }, [existingCustomActions, initial]);

  const idError = validateCustomActionId(id, knownIds);
  const idErrorMessage =
    idError === "required"
      ? t("automationPage.agentEilCustomActionIdRequired")
      : idError === "format"
        ? t("automationPage.agentEilCustomActionIdFormat")
        : idError === "duplicate"
          ? t("automationPage.agentEilCustomActionIdDuplicate")
          : null;

  if (!open) return null;

  const handleSave = () => {
    if (!label.trim() || idError) return;
    onSave({
      id: id.trim(),
      label: label.trim(),
      description: description.trim() || undefined,
      enabled: true,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-700">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">
            {initial ? t("automationPage.agentEilEditCustomAction") : t("automationPage.agentEilNewCustomAction")}
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              {t("automationPage.agentEilCustomActionLabel")} *
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => {
                const next = e.target.value;
                setLabel(next);
                if (!idEdited) setId(slugifyActionId(next));
              }}
              placeholder={t("automationPage.agentEilCustomActionLabelPlaceholder")}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              {t("automationPage.agentEilCustomActionCode")} *
            </span>
            <input
              type="text"
              value={id}
              onChange={(e) => {
                setIdEdited(true);
                setId(e.target.value);
              }}
              placeholder="approve_request"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs dark:border-ink-600 dark:bg-ink-950"
            />
            {idErrorMessage ? <p className="mt-1 text-[10px] text-red-600">{idErrorMessage}</p> : null}
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold text-ink-700 dark:text-ink-300">
              {t("automationPage.agentEilCustomActionDescription")}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs dark:border-ink-600 dark:bg-ink-950"
            />
          </label>
        </div>

        <div className="flex gap-2 border-t border-ink-100 px-4 py-3 dark:border-ink-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-xs font-semibold dark:border-ink-600"
          >
            {t("automationPage.cancel")}
          </button>
          <button
            type="button"
            disabled={!label.trim() || Boolean(idError)}
            onClick={handleSave}
            className={clsx(
              "flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white",
              !label.trim() || idError ? "bg-brand-400/60" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {initial ? t("automationPage.save") : t("automationPage.agentEilCreateCustomAction")}
          </button>
        </div>
      </div>
    </div>
  );
}
