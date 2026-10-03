import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUp,
  Info,
  Lightbulb,
  Megaphone,
  Newspaper,
  Pin,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import clsx from "clsx";
import type { AnnouncementCopy } from "./announcementCopy";

export type AnnouncementCategoryView = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon: string;
  tone: string;
};

export type AnnouncementView = {
  id: string;
  title: string;
  summary: string;
  content: string;
  coverUrl: string | null;
  priority: "NORMAL" | "IMPORTANT" | "CRITICAL";
  isFeatured: boolean;
  isPinned: boolean;
  requiresAcknowledgement: boolean;
  publishedAt: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  category: AnnouncementCategoryView;
  unread?: boolean;
  acknowledgedAt?: string | null;
};

const ICONS = {
  Sparkles,
  ArrowUp,
  Info,
  AlertTriangle,
  Wrench,
  Lightbulb,
  Newspaper,
  Megaphone,
} as const;

const TONE: Record<string, string> = {
  brand: "bg-brand-50 text-brand-800 dark:bg-brand-950/40 dark:text-brand-200",
  sky: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  amber: "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  rose: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
  slate: "bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200",
  emerald: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
};

export function CategoryMark({ category, className }: { category: AnnouncementCategoryView; className?: string }) {
  const Icon = ICONS[category.icon as keyof typeof ICONS] ?? Info;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", TONE[category.tone] ?? TONE.slate, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {category.name}
    </span>
  );
}

export function formatAnnouncementDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatAnnouncementLongDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatRelativeTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const pt = locale !== "en";
  if (minutes < 1) return pt ? "agora" : "now";
  if (minutes < 60) return pt ? `há ${minutes} min` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return pt ? `há ${hours} h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return pt ? `há ${days} d` : `${days}d ago`;
}

function safeHref(url: string): string | null {
  const value = url.trim();
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
  } catch {
    return null;
  }
  return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) nodes.push(text.slice(last, at));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-b-${index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={`${keyPrefix}-i-${index}`}>{token.slice(1, -1)}</em>);
    } else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      const href = link ? safeHref(link[2] ?? "") : null;
      if (link && href) {
        nodes.push(
          href.startsWith("/") ? (
            <Link key={`${keyPrefix}-l-${index}`} to={href} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
              {link[1]}
            </Link>
          ) : (
            <a key={`${keyPrefix}-l-${index}`} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
              {link[1]}
            </a>
          ),
        );
      } else {
        nodes.push(token);
      }
    }
    last = at + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function AnnouncementMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let listKind: "ul" | "ol" | null = null;

  const flushList = () => {
    if (!listKind || list.length === 0) return;
    const items = list;
    const kind = listKind;
    blocks.push(
      kind === "ul" ? (
        <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm leading-6 text-ink-700 dark:text-ink-200">
          {items.map((item, i) => <li key={i}>{renderInline(item, `uli-${blocks.length}-${i}`)}</li>)}
        </ul>
      ) : (
        <ol key={`ol-${blocks.length}`} className="list-decimal space-y-1 pl-5 text-sm leading-6 text-ink-700 dark:text-ink-200">
          {items.map((item, i) => <li key={i}>{renderInline(item, `oli-${blocks.length}-${i}`)}</li>)}
        </ol>
      ),
    );
    list = [];
    listKind = null;
  };

  lines.forEach((raw, lineIndex) => {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet) {
      if (listKind && listKind !== "ul") flushList();
      listKind = "ul";
      list.push(bullet[1] ?? "");
      return;
    }
    if (ordered) {
      if (listKind && listKind !== "ol") flushList();
      listKind = "ol";
      list.push(ordered[1] ?? "");
      return;
    }
    flushList();
    if (!line) return;
    if (line === "---") {
      blocks.push(<hr key={`hr-${lineIndex}`} className="border-ink-200 dark:border-soft-border" />);
      return;
    }
    if (line.startsWith("> ")) {
      blocks.push(
        <aside key={`call-${lineIndex}`} className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 text-sm leading-6 text-ink-800 dark:border-soft-border dark:bg-ink-800/60 dark:text-ink-100">
          {renderInline(line.slice(2), `c-${lineIndex}`)}
        </aside>,
      );
      return;
    }
    if (line.startsWith("### ")) {
      blocks.push(<h3 key={`h-${lineIndex}`} className="text-base font-semibold text-ink-900 dark:text-ink-50">{renderInline(line.slice(4), `h3-${lineIndex}`)}</h3>);
      return;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h2 key={`h-${lineIndex}`} className="text-lg font-semibold text-ink-900 dark:text-ink-50">{renderInline(line.slice(3), `h2-${lineIndex}`)}</h2>);
      return;
    }
    if (line.startsWith("# ")) {
      blocks.push(<h2 key={`h-${lineIndex}`} className="text-xl font-semibold text-ink-900 dark:text-ink-50">{renderInline(line.slice(2), `h1-${lineIndex}`)}</h2>);
      return;
    }
    blocks.push(
      <p key={`p-${lineIndex}`} className="text-sm leading-6 text-ink-700 dark:text-ink-200">
        {renderInline(line, `p-${lineIndex}`)}
      </p>,
    );
  });
  flushList();
  return <div className="space-y-3">{blocks}</div>;
}

export function AnnouncementCard({
  item,
  copy,
  locale,
}: {
  item: AnnouncementView;
  copy: AnnouncementCopy;
  locale: string;
}) {
  return (
    <article className="group rounded-2xl border border-ink-200 bg-white p-5 transition-colors hover:border-ink-300 dark:border-soft-border dark:bg-ink-900/80 dark:hover:border-ink-600">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryMark category={item.category} />
        {item.isFeatured ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <Star className="h-3.5 w-3.5" aria-hidden />
            {copy.featured}
          </span>
        ) : null}
        {item.isPinned ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-500 dark:text-ink-400">
            <Pin className="h-3.5 w-3.5" aria-hidden />
            {copy.pinned}
          </span>
        ) : null}
        {item.unread ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600 dark:bg-brand-400" aria-hidden />
            {copy.new}
          </span>
        ) : null}
        <time className="ml-auto text-xs text-ink-500 dark:text-ink-400" dateTime={item.publishedAt ?? undefined}>
          {formatAnnouncementDate(item.publishedAt, locale)}
        </time>
      </div>
      {item.coverUrl ? (
        <img src={item.coverUrl} alt="" className="mt-4 aspect-[2/1] w-full rounded-xl object-cover" />
      ) : null}
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">{item.title}</h2>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-600 dark:text-ink-300">{item.summary}</p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Link to={`/announcements/${item.id}`} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
          {copy.open}
        </Link>
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {copy.byline} · {formatRelativeTime(item.publishedAt, locale)}
        </span>
      </div>
    </article>
  );
}

export function AnnouncementCta({ label, url }: { label: string; url: string }) {
  const href = safeHref(url);
  if (!href) return null;
  const className = "inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700";
  if (href.startsWith("/")) return <Link to={href} className={className}>{label}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{label}</a>;
}
