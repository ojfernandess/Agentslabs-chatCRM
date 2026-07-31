/** Partilhado entre PublicApiDocsPage e secções de guia. */

export function DocCodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-visible whitespace-pre-wrap break-words rounded-md border border-ink-200/80 bg-ink-900/[0.03] p-3 font-mono text-[11px] leading-relaxed text-ink-800 print:overflow-visible print:whitespace-pre-wrap dark:border-ink-700 dark:bg-black/25 dark:text-ink-300">
      {children.trim() || "—"}
    </pre>
  );
}
