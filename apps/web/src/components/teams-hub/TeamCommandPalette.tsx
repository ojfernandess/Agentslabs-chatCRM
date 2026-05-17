import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  onRun: () => void;
}

export function TeamCommandPalette({
  open,
  onClose,
  actions,
  placeholder,
  emptyLabel,
}: {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
  placeholder: string;
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const raw = q.trim().toLowerCase();
    if (!raw) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(raw) || a.hint?.toLowerCase().includes(raw));
  }, [actions, q]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-950"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
          <Search className="h-4 w-4 text-ink-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-400 dark:text-ink-50"
          />
          <kbd className="rounded border border-ink-200 px-1.5 py-0.5 text-[10px] text-ink-500 dark:border-ink-600">
            Esc
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-ink-500">{emptyLabel}</li>
          ) : (
            filtered.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-900/60"
                  onClick={() => {
                    a.onRun();
                    onClose();
                  }}
                >
                  <span className="font-medium text-ink-900 dark:text-ink-50">{a.label}</span>
                  {a.hint ? <span className="text-xs text-ink-500">{a.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}