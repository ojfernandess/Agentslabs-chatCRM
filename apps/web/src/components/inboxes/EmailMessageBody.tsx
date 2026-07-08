import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

function buildEmailDocument(html: string, origin: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${origin}/" target="_blank" />
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.45;
    color: #1f2937;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; }
  a { color: #1d4ed8; }
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
    doc.write(buildEmailDocument(html, window.location.origin));
    doc.close();

    const resize = () => {
      const h = Math.max(
        doc.body?.scrollHeight ?? 0,
        doc.documentElement?.scrollHeight ?? 0,
        80,
      );
      setFrameHeight(Math.min(h + 8, 4000));
    };

    resize();
    const imgs = Array.from(doc.images ?? []);
    for (const img of imgs) {
      if (!img.complete) img.addEventListener("load", resize, { once: true });
    }
    const timer = window.setTimeout(resize, 120);
    const timer2 = window.setTimeout(resize, 600);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(timer2);
    };
  }, [html]);

  if (!display) return null;

  if (html) {
    return (
      <div className={clsx("email-html-frame w-full overflow-hidden", className)}>
        <iframe
          ref={iframeRef}
          title="Email"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          referrerPolicy="no-referrer"
          className="w-full border-0 bg-transparent"
          style={{ height: frameHeight, minHeight: 80 }}
        />
      </div>
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
