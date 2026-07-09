import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  emailHtmlFromStoredContent,
  emailMessageDisplayBody,
  isEmailHtmlStoredContent,
  sanitizeEmailHtml,
} from "@openconduit/shared";
import clsx from "clsx";
import { useDarkMode } from "@/hooks/useDarkMode";

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function trimTrailingPunctuation(url: string): { href: string; trailing: string } {
  let href = url;
  let trailing = "";
  while (/[),.;:!?\]]$/.test(href)) {
    trailing = href.slice(-1) + trailing;
    href = href.slice(0, -1);
  }
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

function buildEmailDocument(html: string, origin: string, dark: boolean): string {
  const bg = dark ? "#0f172a" : "#ffffff";
  const text = dark ? "#e2e8f0" : "#1f2937";
  const link = dark ? "#93c5fd" : "#1d4ed8";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="${dark ? "dark" : "light"}" />
<base href="${origin}/" target="_blank" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: ${bg};
    overflow-x: hidden;
    width: 100%;
    color-scheme: ${dark ? "dark" : "light"};
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.45;
    color: ${text};
    word-break: break-word;
    overflow-wrap: anywhere;
    box-sizing: border-box;
  }
  *, *::before, *::after { box-sizing: border-box; }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; width: auto !important; }
  td, th { word-break: break-word; }
  a { color: ${link}; }
</style>
</head>
<body>${html}</body>
</html>`;
}

export function EmailMessageBody({
  body,
  className,
}: {
  body: string | null | undefined;
  className?: string;
}) {
  const isDark = useDarkMode();
  const display = useMemo(() => emailMessageDisplayBody(body), [body]);
  const html = useMemo(() => {
    if (!display) return null;
    if (!isEmailHtmlStoredContent(display)) return null;
    const raw = emailHtmlFromStoredContent(display) ?? display;
    return sanitizeEmailHtml(raw);
  }, [display]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(160);

  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(buildEmailDocument(html, window.location.origin, isDark));
    doc.close();

    let cancelled = false;
    const resize = () => {
      if (cancelled) return;
      const h = Math.max(
        doc.body?.scrollHeight ?? 0,
        doc.documentElement?.scrollHeight ?? 0,
        80,
      );
      setFrameHeight((prev) => {
        const next = Math.min(h + 12, 8000);
        return Math.abs(prev - next) < 4 ? prev : next;
      });
    };

    resize();
    const imgs = Array.from(doc.images ?? []);
    for (const img of imgs) {
      if (!img.complete) img.addEventListener("load", resize, { once: true });
    }
    const timer = window.setTimeout(resize, 150);
    const timer2 = window.setTimeout(resize, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(timer2);
    };
  }, [html, isDark]);

  if (!display) return null;

  if (html) {
    return (
      <div
        className={clsx(
          "email-html-frame w-full min-w-0 overflow-hidden rounded-md border border-ink-100 dark:border-ink-700/60",
          className,
        )}
      >
        <iframe
          ref={iframeRef}
          title="Email"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          referrerPolicy="no-referrer"
          scrolling="no"
          className={clsx(
            "block w-full max-w-full border-0",
            isDark ? "bg-[#0f172a]" : "bg-white",
          )}
          style={{ height: frameHeight, minHeight: 80 }}
        />
      </div>
    );
  }

  return (
    <p
      className={clsx(
        "whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-relaxed text-inherit",
        className,
      )}
    >
      {linkifyPlainText(display)}
    </p>
  );
}
