import { FileText, Download } from "lucide-react";
import clsx from "clsx";

export function isLikelyDocumentCaption(body: string): boolean {
  const b = body.trim();
  return b.includes("\n") || /\s/.test(b);
}

function fileLabelFromBody(body: string | null | undefined, fallback: string): string {
  const t = body?.trim();
  if (!t || t === fallback) return fallback;
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

/** Cartão de documento estilo WhatsApp (legível em bolhas claras e escuras). */
export function DocumentAttachmentCard({
  href,
  body,
  downloadLabel,
  inbound,
}: {
  href: string;
  body: string | null | undefined;
  downloadLabel: string;
  inbound: boolean;
}) {
  const displayName = fileLabelFromBody(body, downloadLabel);
  return (
    <a
      href={href}
      download
      target="_blank"
      rel="noreferrer"
      className={clsx(
        "mt-0.5 flex min-w-[12rem] max-w-full items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        inbound
          ? "border-ink-200/80 bg-ink-50/90 hover:bg-ink-100 dark:border-ink-600 dark:bg-ink-800/80 dark:hover:bg-ink-750"
          : "border-ink-900/10 bg-white/90 hover:bg-white dark:border-white/15 dark:bg-ink-900/40 dark:hover:bg-ink-900/55",
      )}
    >
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          inbound ? "bg-brand-500/15 text-brand-700 dark:bg-brand-400/20 dark:text-brand-200" : "bg-brand-500/20 text-brand-800 dark:text-brand-100",
        )}
      >
        <FileText className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900 dark:text-ink-50">{displayName}</span>
        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-brand-700 dark:text-brand-300">
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {downloadLabel}
        </span>
      </span>
    </a>
  );
}

export function ChatImageThumbnail({
  src,
  alt,
  outbound,
  onOpen,
}: {
  src: string;
  alt: string;
  outbound: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full cursor-zoom-in overflow-hidden rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <img
        src={src}
        alt={alt}
        className={clsx("max-h-64 max-w-full object-contain", outbound && "opacity-95")}
        loading="lazy"
        decoding="async"
      />
    </button>
  );
}
