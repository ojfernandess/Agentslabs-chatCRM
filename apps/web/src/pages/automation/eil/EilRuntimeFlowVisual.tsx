import { ArrowDown } from "lucide-react";

type Props = {
  steps: string[];
};

export function EilRuntimeFlowVisual({ steps }: Props) {
  return (
    <div className="mt-3 flex flex-col items-center gap-0">
      {steps.map((label, idx) => (
        <div key={label} className="flex w-full flex-col items-center">
          <div className="w-full rounded-lg border border-ink-600/80 bg-ink-800 px-3 py-2.5 text-center shadow-sm dark:border-ink-500/40 dark:bg-ink-950/90">
            <p className="text-[11px] font-medium leading-snug text-ink-50">{label}</p>
          </div>
          {idx < steps.length - 1 ? (
            <ArrowDown className="my-1 h-4 w-4 shrink-0 text-sky-400" aria-hidden strokeWidth={2.5} />
          ) : null}
        </div>
      ))}
    </div>
  );
}
