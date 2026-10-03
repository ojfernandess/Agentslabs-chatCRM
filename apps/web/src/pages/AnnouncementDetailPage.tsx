import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { announcementText } from "@/components/announcements/announcementCopy";
import {
  AnnouncementCta,
  AnnouncementMarkdown,
  CategoryMark,
  formatAnnouncementLongDate,
  formatRelativeTime,
  type AnnouncementView,
} from "@/components/announcements/announcementUi";

export function AnnouncementDetailPage() {
  const { id } = useParams();
  const { locale } = useI18n();
  const copy = announcementText(locale);
  const [item, setItem] = useState<AnnouncementView | null>(null);
  const [error, setError] = useState("");
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void api
      .get<AnnouncementView>(`/announcements/${id}`)
      .then((row) => {
        if (cancelled) return;
        setItem({ ...row, unread: false });
        window.dispatchEvent(new CustomEvent("openconduit:announcement-read"));
      })
      .catch(() => {
        if (!cancelled) setError(copy.loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [id, copy.loadError]);

  if (error) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-rose-700 dark:text-rose-300">{error}</div>;
  }
  if (!item) {
    return <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-ink-500">{locale === "en" ? "Loading…" : "Carregando…"}</div>;
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to="/announcements" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-50">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {copy.back}
      </Link>
      <header className="mt-4">
        <CategoryMark category={item.category} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50 sm:text-3xl">{item.title}</h1>
        <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
          {formatAnnouncementLongDate(item.publishedAt, locale)} · {copy.byline} · {formatRelativeTime(item.publishedAt, locale)}
        </p>
      </header>
      {item.coverUrl ? <img src={item.coverUrl} alt="" className="mt-6 w-full rounded-2xl object-cover" /> : null}
      <p className="mt-6 text-base leading-7 text-ink-800 dark:text-ink-100">{item.summary}</p>
      <div className="mt-6">
        <AnnouncementMarkdown content={item.content} />
      </div>
      {item.ctaLabel && item.ctaUrl ? (
        <div className="mt-8">
          <AnnouncementCta label={item.ctaLabel} url={item.ctaUrl} />
        </div>
      ) : null}
      {item.requiresAcknowledgement ? (
        <div className="mt-8">
          {item.acknowledgedAt ? (
            <p className="text-sm text-ink-500 dark:text-ink-400">{copy.acknowledged}</p>
          ) : (
            <button
              type="button"
              disabled={acking}
              className="min-h-11 rounded-xl bg-ink-900 px-4 text-sm font-semibold text-white disabled:opacity-60 dark:bg-ink-100 dark:text-ink-900"
              onClick={() => {
                setAcking(true);
                void api.post<{ acknowledgedAt: string }>(`/announcements/${item.id}/acknowledge`).then((row) => {
                  setItem({ ...item, acknowledgedAt: row.acknowledgedAt });
                }).finally(() => setAcking(false));
              }}
            >
              {copy.acknowledge}
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}
