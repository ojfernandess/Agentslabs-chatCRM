import clsx from "clsx";
import type { ExecutionFlowGraph } from "./executionQualityTypes";

const KIND_STYLES: Record<string, string> = {
  message: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/40",
  agent: "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40",
  condition: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
  tool: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40",
  response: "border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/40",
  supervisor: "border-fuchsia-300 bg-fuchsia-50 dark:border-fuchsia-800 dark:bg-fuchsia-950/40",
  quality: "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40",
};

export function ExecutionFlowView({
  graph,
  t,
}: {
  graph: ExecutionFlowGraph | null | undefined;
  t: (key: string) => string;
}) {
  if (!graph?.nodes?.length) {
    return <p className="p-4 text-sm text-ink-500">{t("automationPage.execFlowEmpty")}</p>;
  }

  return (
    <div className="flex flex-col items-center gap-0 p-4">
      {graph.nodes.map((node, i) => (
        <div key={node.id} className="flex w-full max-w-md flex-col items-center">
          <div
            className={clsx(
              "w-full rounded-xl border-2 px-4 py-3 text-center shadow-sm",
              KIND_STYLES[node.kind] ?? "border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-900",
            )}
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">
              {t(`automationPage.execFlowKind_${node.kind}`)}
            </p>
            <p className="mt-1 text-sm font-semibold text-ink-900 dark:text-ink-50">{node.label}</p>
            {node.level ? (
              <p className="mt-1 text-[10px] text-ink-400">
                #{node.sequence} · {node.level}
              </p>
            ) : null}
          </div>
          {i < graph.nodes.length - 1 ? (
            <div className="flex h-8 flex-col items-center justify-center text-ink-300 dark:text-ink-600" aria-hidden>
              <span className="h-4 w-px bg-ink-200 dark:bg-ink-700" />
              <span>↓</span>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
