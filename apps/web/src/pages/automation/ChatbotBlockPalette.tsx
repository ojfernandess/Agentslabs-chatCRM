import clsx from "clsx";
import { Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  CHATBOT_BLOCK_META,
  CHATBOT_CATEGORY_META,
  PALETTE_BY_CATEGORY,
  type ChatbotBlockCategory,
} from "./chatbotBlockMeta";

interface Props {
  onAddBlock: (type: string) => void;
}

export function ChatbotBlockPalette({ onAddBlock }: Props) {
  const { t } = useI18n();

  const blocksForCategory = (cat: ChatbotBlockCategory) =>
    Object.values(CHATBOT_BLOCK_META).filter((b) => b.category === cat && b.type !== "start" && b.type !== "end");

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-ink-200/80 bg-white dark:border-ink-800 dark:bg-[#151821]">
      <div className="border-b border-ink-100 px-3 py-3 dark:border-ink-800">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">{t("chatbotPage.paletteTitle")}</p>
        <p className="mt-0.5 text-[10px] text-ink-400">{t("chatbotPage.paletteHint")}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {PALETTE_BY_CATEGORY.map((cat) => {
          const catMeta = CHATBOT_CATEGORY_META[cat];
          const blocks = blocksForCategory(cat);
          if (!blocks.length) return null;
          return (
            <div key={cat} className="mb-4">
              <p
                className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wide"
                style={{ color: catMeta.accent }}
              >
                {t(catMeta.labelKey)}
              </p>
              <ul className="space-y-1">
                {blocks.map((b) => {
                  const Icon = b.icon;
                  return (
                    <li key={b.type}>
                      <button
                        type="button"
                        onClick={() => onAddBlock(b.type)}
                        className={clsx(
                          "group flex w-full items-center gap-2 rounded-xl border px-2 py-2 text-left transition hover:shadow-sm",
                          b.borderColor,
                          b.bgLight,
                        )}
                      >
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                          style={{ backgroundColor: b.color }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold text-ink-800 dark:text-ink-100">
                            {t(b.labelKey)}
                          </span>
                        </span>
                        <Plus className="h-3.5 w-3.5 shrink-0 text-ink-400 opacity-0 group-hover:opacity-100" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
