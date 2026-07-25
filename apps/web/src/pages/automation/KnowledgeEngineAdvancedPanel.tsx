import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useState } from "react";
import { KnowledgeAdminPanel, KnowledgeCenterPanel } from "@/pages/automation/KnowledgeAdminPanel";
import { KnowledgeInspectorPanel } from "@/pages/automation/KnowledgeInspectorPanel";

type BotOption = { id: string; name: string };

/**
 * Secção opcional abaixo do hub legado — não altera a Base de conhecimento IA existente.
 * Visível apenas para administradores da organização.
 */
export function KnowledgeEngineAdvancedPanel({
  t,
  bots,
}: {
  t: (key: string) => string;
  bots: BotOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-dashed border-sky-300/80 bg-sky-50/10 dark:border-sky-800/50 dark:bg-sky-950/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-800 dark:text-ink-100">
          <Sparkles className="h-4 w-4 text-sky-600" />
          {t("automationPage.knowledgeEngineAdvancedTitle")}
        </span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      <p className="px-4 pb-2 text-[11px] leading-relaxed text-ink-500">
        {t("automationPage.knowledgeEngineAdvancedHelp")}
      </p>
      {open ? (
        <div className="space-y-4 border-t border-sky-200/60 px-4 pb-4 pt-3 dark:border-sky-900/40">
          <KnowledgeCenterPanel t={t} />
          <KnowledgeAdminPanel t={t} />
          <KnowledgeInspectorPanel t={t} bots={bots} />
        </div>
      ) : null}
    </div>
  );
}
