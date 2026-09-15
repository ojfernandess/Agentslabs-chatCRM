import { Link } from "react-router-dom";
import type { HelpArticleBlock } from "@/lib/help/types";
import { HelpCallout } from "./HelpCallout";
import { HelpSteps } from "./HelpSteps";

export function ArticleRenderer({ blocks }: { blocks: HelpArticleBlock[] }) {
  return (
    <div className="help-article prose prose-ink dark:prose-invert max-w-none">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            if (block.level === 2) {
              return (
                <h2
                  key={`${block.text}-${i}`}
                  id={block.id}
                  className="scroll-mt-24 text-xl font-bold tracking-tight text-ink-900 dark:text-ink-50"
                >
                  {block.text}
                </h2>
              );
            }
            return (
              <h3
                key={`${block.text}-${i}`}
                id={block.id}
                className="scroll-mt-24 text-lg font-semibold text-ink-800 dark:text-ink-100"
              >
                {block.text}
              </h3>
            );
          case "paragraph":
            return (
              <p key={i} className="text-[15px] leading-7 text-ink-700 dark:text-ink-300">
                {block.text}
              </p>
            );
          case "list":
            if (block.ordered) {
              return (
                <ol key={i} className="my-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-ink-700 dark:text-ink-300">
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ol>
              );
            }
            return (
              <ul key={i} className="my-4 list-disc space-y-2 pl-5 text-[15px] leading-7 text-ink-700 dark:text-ink-300">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case "steps":
            return <HelpSteps key={i} steps={block.steps} />;
          case "callout":
            return <HelpCallout key={i} variant={block.variant} title={block.title} text={block.text} />;
          case "link":
            if (block.external) {
              return (
                <p key={i}>
                  <a
                    href={block.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {block.text}
                  </a>
                </p>
              );
            }
            return (
              <p key={i}>
                <Link to={block.href} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  {block.text}
                </Link>
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
