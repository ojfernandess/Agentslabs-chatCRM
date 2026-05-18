import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { GitBranchPlus, Pencil, Trash2, X } from "lucide-react";
import {
  newFallbackId,
  type InstructionFallback,
  type InstructionFallbackAction,
} from "@/pages/automation/instructionFallbacks";

type TeamOption = { id: string; name: string };

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fallbacks: InstructionFallback[];
  onChange: (next: InstructionFallback[]) => void;
  teams?: TeamOption[];
  t: (path: string) => string;
}

const ACTIONS: InstructionFallbackAction[] = ["transfer_human", "transfer_team", "set_pending", "custom"];

export function InstructionFallbacksEditor({ textareaRef, fallbacks, onChange, teams = [], t }: Props) {
  const selectionRef = useRef<{ text: string } | null>(null);
  const [selection, setSelection] = useState<{ text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [action, setAction] = useState<InstructionFallbackAction>("transfer_human");
  const [teamId, setTeamId] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");

  const readSelection = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setSelection(null);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end > start) {
      const text = el.value.slice(start, end).trim();
      if (text) {
        selectionRef.current = { text };
        setSelection({ text });
      } else {
        setSelection(null);
      }
    } else if (!selectionRef.current) {
      setSelection(null);
    }
  }, [textareaRef]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const onSelect = () => readSelection();
    el.addEventListener("select", onSelect);
    el.addEventListener("mouseup", onSelect);
    el.addEventListener("keyup", onSelect);
    return () => {
      el.removeEventListener("select", onSelect);
      el.removeEventListener("mouseup", onSelect);
      el.removeEventListener("keyup", onSelect);
    };
  }, [textareaRef, readSelection]);

  const openCreateModal = () => {
    const text = selectionRef.current?.text ?? selection?.text;
    if (!text) return;
    selectionRef.current = { text };
    setSelection({ text });
    setEditingId(null);
    setAction("transfer_team");
    setTeamId(teams[0]?.id ?? "");
    setCustomInstruction("");
    setModalOpen(true);
  };

  const openEditModal = (fb: InstructionFallback) => {
    setEditingId(fb.id);
    setAction(fb.action);
    setTeamId(fb.teamId ?? "");
    setCustomInstruction(fb.customInstruction ?? "");
    selectionRef.current = { text: fb.triggerText };
    setSelection({ text: fb.triggerText });
    setModalOpen(true);
  };

  const saveModal = () => {
    const triggerText = (selectionRef.current?.text ?? selection?.text ?? "").trim();
    if (!triggerText) return;
    if (action === "transfer_team" && !teamId.trim()) return;
    if (action === "custom" && !customInstruction.trim()) return;

    const team = teams.find((x) => x.id === teamId);
    const supplemental = customInstruction.trim();
    const row: InstructionFallback = {
      id: editingId ?? newFallbackId(),
      triggerText,
      action,
      teamId: action === "transfer_team" ? teamId : null,
      teamName: action === "transfer_team" ? team?.name ?? null : null,
      customInstruction:
        action === "custom"
          ? supplemental
          : supplemental && (action === "transfer_team" || action === "transfer_human")
            ? supplemental
            : null,
    };

    if (editingId) {
      onChange(fallbacks.map((f) => (f.id === editingId ? row : f)));
    } else {
      onChange([...fallbacks, row]);
    }
    setModalOpen(false);
    setEditingId(null);
    setSelection(null);
    selectionRef.current = null;
  };

  const removeFallback = (id: string) => {
    onChange(fallbacks.filter((f) => f.id !== id));
  };

  const showSupplementalField =
    action === "custom" || action === "transfer_team" || action === "transfer_human";

  return (
    <div className="space-y-3">
      {selection ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/90 px-3 py-2 dark:border-violet-900/40 dark:bg-violet-950/30">
          <span className="text-[11px] text-ink-600 dark:text-ink-300">
            {t("automationPage.instructionFallback.selected")}: «{selection.text.slice(0, 80)}
            {selection.text.length > 80 ? "…" : ""}»
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openCreateModal}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-violet-700"
          >
            <GitBranchPlus className="h-3.5 w-3.5" />
            {t("automationPage.instructionFallback.add")}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-ink-500 dark:text-ink-400">{t("automationPage.instructionFallback.hint")}</p>
      )}

      {fallbacks.length > 0 ? (
        <ul className="space-y-2 rounded-xl border border-ink-200/80 bg-white/80 p-2 dark:border-ink-700 dark:bg-ink-950/50">
          {fallbacks.map((fb) => (
            <li
              key={fb.id}
              className="flex flex-col gap-2 rounded-lg border border-ink-100 bg-ink-50/80 px-3 py-2 text-xs dark:border-ink-800 dark:bg-ink-900/40 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-800 dark:text-ink-100">«{fb.triggerText}»</p>
                <p className="mt-1 text-ink-600 dark:text-ink-400">
                  {t(`automationPage.instructionFallback.action_${fb.action}`)}
                  {fb.action === "transfer_team" && fb.teamName ? ` → ${fb.teamName}` : ""}
                </p>
                {fb.customInstruction ? (
                  <p className="mt-1 text-ink-500 dark:text-ink-400">{fb.customInstruction}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => openEditModal(fb)}
                  className="rounded p-1.5 text-ink-500 hover:bg-white dark:hover:bg-ink-800"
                  title={t("common.edit")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeFallback(fb.id)}
                  className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  title={t("common.delete")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {modalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
            onClick={() => setModalOpen(false)}
            aria-label={t("common.cancel")}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl dark:border-ink-700 dark:bg-ink-950">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">
                {editingId
                  ? t("automationPage.instructionFallback.editTitle")
                  : t("automationPage.instructionFallback.createTitle")}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 text-ink-500">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-700 dark:bg-ink-900 dark:text-ink-200">
              <span className="font-semibold">{t("automationPage.instructionFallback.trigger")}:</span> «
              {selectionRef.current?.text ?? selection?.text ?? ""}»
            </p>

            <p className="mb-2 text-xs font-semibold text-ink-600 dark:text-ink-400">
              {t("automationPage.instructionFallback.actionLabel")}
            </p>
            <div className="mb-3 flex flex-col gap-1.5">
              {ACTIONS.map((a) => (
                <label
                  key={a}
                  className={clsx(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition",
                    action === a
                      ? "border-violet-500 bg-violet-500/10 font-semibold text-violet-900 dark:text-violet-100"
                      : "border-ink-200 dark:border-ink-700",
                  )}
                >
                  <input
                    type="radio"
                    name="fallback-action"
                    checked={action === a}
                    onChange={() => setAction(a)}
                    className="sr-only"
                  />
                  {t(`automationPage.instructionFallback.action_${a}`)}
                </label>
              ))}
            </div>

            {action === "transfer_team" ? (
              <label className="mb-3 block text-xs">
                <span className="font-semibold text-ink-600 dark:text-ink-400">
                  {t("automationPage.instructionFallback.team")}
                </span>
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="input-field mt-1 w-full text-sm"
                >
                  <option value="">{t("automationPage.instructionFallback.selectTeam")}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {showSupplementalField ? (
              <label className="mb-3 block text-xs">
                <span className="font-semibold text-ink-600 dark:text-ink-400">
                  {action === "custom"
                    ? t("automationPage.instructionFallback.customInstruction")
                    : t("automationPage.instructionFallback.supplementalSteps")}
                </span>
                <textarea
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  rows={3}
                  className="input-field mt-1 w-full resize-y text-sm"
                  placeholder={
                    action === "transfer_team"
                      ? t("automationPage.instructionFallback.supplementalPlaceholderTeam")
                      : t("automationPage.instructionFallback.customPlaceholder")
                  }
                />
              </label>
            ) : null}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg px-3 py-2 text-sm text-ink-600">
                {t("common.cancel")}
              </button>
              <button type="button" onClick={saveModal} className="btn-primary text-sm">
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}