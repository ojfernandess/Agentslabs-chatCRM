type Step = { title: string; body?: string };

export function HelpSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="my-6 space-y-0">
      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-4 pb-8 last:pb-0">
          {i < steps.length - 1 ? (
            <span
              className="absolute left-[15px] top-8 bottom-0 w-px bg-brand-200 dark:bg-brand-800"
              aria-hidden
            />
          ) : null}
          <span
            className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white dark:bg-brand-500"
            aria-hidden
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="font-semibold text-ink-900 dark:text-ink-50">{step.title}</p>
            {step.body ? (
              <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-ink-400">{step.body}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
