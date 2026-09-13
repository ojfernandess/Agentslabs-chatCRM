import { useState } from "react";
import clsx from "clsx";
import { CircleHelp, X } from "lucide-react";
import { EilRuntimeFlowVisual } from "./EilRuntimeFlowVisual.js";

export type EilHelpSection =
  | { kind: "text"; title: string; body: string }
  | { kind: "runtime-flow"; title: string; intro?: string; steps: string[] };

type Props = {
  label: string;
  title: string;
  sections: EilHelpSection[];
};

export function EilHelpHint({ label, title, sections }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen(true)}
        className="rounded-full p-0.5 text-ink-400 transition-colors hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:hover:text-brand-400"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="eil-help-title"
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl dark:border-ink-700 dark:bg-ink-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-ink-700">
              <h2 id="eil-help-title" className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                {title}
              </h2>
              <button
                type="button"
                aria-label={label}
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              <div className="space-y-5">
                {sections.map((s) => (
                  <section key={s.title}>
                    <h3 className="text-xs font-semibold text-ink-800 dark:text-ink-100">{s.title}</h3>
                    {s.kind === "text" ? (
                      <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">
                        {s.body}
                      </p>
                    ) : (
                      <>
                        {s.intro ? (
                          <p className="mt-1 text-[11px] leading-relaxed text-ink-600 dark:text-ink-400">{s.intro}</p>
                        ) : null}
                        <EilRuntimeFlowVisual steps={s.steps} />
                      </>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function EilActiveBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        active
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
          : "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400",
      )}
    >
      {label}
    </span>
  );
}
