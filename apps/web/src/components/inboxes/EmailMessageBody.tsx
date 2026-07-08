import { useMemo, type ReactNode } from "react";
import {
  emailHtmlFromStoredContent,
  emailMessageDisplayBody,
  isEmailHtmlStoredContent,
  sanitizeEmailHtml,
} from "@openconduit/shared";
import clsx from "clsx";

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function trimTrailingPunctuation(url: string): { href: string; trailing: string } {
  let href = url;
  let trailing = "";
  while (/[),.;:!?\]]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
  // Unwrap [url] style leftovers from plain-text digests
  if (href.startsWith("[") && href.endsWith("]")) {
    href = href.slice(1, -1);
  }
  return { href, trailing };
}

function linkifyPlainText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  const re = new RegExp(URL_RE.source, "gi");
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text))) {
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    const raw = match[0];
    const { href, trailing } = trimTrailingPunctuation(raw);
    if (/^https?:\/\//i.test(href)) {
      nodes.push(
        <a
          key={`u-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-brand-700 underline decoration-brand-400/60 underline-offset-2 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
        >
          {href}
        </a>,
      );
      if (trailing) nodes.push(trailing);
    } else {
      nodes.push(raw);
    }
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function EmailMessageBody({
  body,
  className,
}: {
  body: string | null | undefined;
  className?: string;
}) {
  const display = useMemo(() => emailMessageDisplayBody(body), [body]);
  const html = useMemo(() => {
    if (!display) return null;
    if (!isEmailHtmlStoredContent(display)) return null;
    const raw = emailHtmlFromStoredContent(display) ?? display;
    return sanitizeEmailHtml(raw);
  }, [display]);

  if (!display) return null;

  if (html) {
    return (
      <div
        className={clsx(
          "email-html-body max-w-none overflow-x-auto break-words text-sm leading-relaxed text-ink-800 dark:text-ink-100",
          "[&_a]:break-all [&_a]:text-brand-700 [&_a]:underline [&_a]:decoration-brand-400/60 [&_a]:underline-offset-2",
          "dark:[&_a]:text-brand-300",
          "[&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md",
          "[&_table]:max-w-full [&_td]:align-top",
          "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <p
      className={clsx(
        "whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed",
        className,
      )}
    >
      {linkifyPlainText(display)}
    </p>
  );
}
