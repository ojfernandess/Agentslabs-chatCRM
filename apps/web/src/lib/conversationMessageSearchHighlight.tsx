import { Fragment } from "react";

export function splitMessageHighlight(text: string, query: string): Array<string | { mark: string }> {
  const q = query.trim();
  if (!q) return [text];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(re).filter((part) => part.length > 0);
  return parts.map((part) => (part.toLowerCase() === q.toLowerCase() ? { mark: part } : part));
}

export function MessageTextWithHighlight({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const parts = splitMessageHighlight(text, query);
  return (
    <p className={className}>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <mark
            key={index}
            className="rounded-sm bg-amber-200/90 px-0.5 text-inherit dark:bg-amber-400/35"
          >
            {part.mark}
          </mark>
        ),
      )}
    </p>
  );
}
