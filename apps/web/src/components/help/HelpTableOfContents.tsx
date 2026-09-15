import type { HelpArticleBlock } from "@/lib/help/types";
import clsx from "clsx";

function extractHeadings(blocks: HelpArticleBlock[]) {
  return blocks.filter(
    (b): b is Extract<HelpArticleBlock, { type: "heading" }> =>
      b.type === "heading" && Boolean(b.id),
  );
}

export function HelpTableOfContents({ blocks }: { blocks: HelpArticleBlock[] }) {
  const headings = extractHeadings(blocks);
  if (headings.length < 3) return null;

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 rounded-xl border border-ink-200 bg-white/80 p-4 backdrop-blur dark:border-ink-700 dark:bg-ink-900/60">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Nesta página</p>
        <ul className="mt-3 space-y-2 text-sm">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={clsx(
                  "block text-ink-600 hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-400",
                  h.level === 3 && "pl-3 text-[13px]",
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
