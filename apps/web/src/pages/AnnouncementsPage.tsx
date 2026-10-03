import { useEffect, useState } from "react";
import { Newspaper } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { announcementText } from "@/components/announcements/announcementCopy";
import { AnnouncementCard, type AnnouncementCategoryView, type AnnouncementView } from "@/components/announcements/announcementUi";

type ListResponse = {
  items: AnnouncementView[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
};

export function AnnouncementsPage() {
  const { locale } = useI18n();
  const copy = announcementText(locale);
  const [categories, setCategories] = useState<AnnouncementCategoryView[]>([]);
  const [category, setCategory] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    void api.get<AnnouncementCategoryView[]>("/announcements/categories").then(setCategories).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(q.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (unreadOnly) params.set("unread", "1");
    void api
      .get<ListResponse>(`/announcements?${params.toString()}`)
      .then((row) => {
        if (!cancelled) {
          setData(row);
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled) setError(copy.loadError);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, query, category, unreadOnly, copy.loadError, reload]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">{copy.title}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-600 dark:text-ink-300">{copy.subtitle}</p>
        </div>
        <button
          type="button"
          className="min-h-11 self-start text-sm font-medium text-ink-600 underline-offset-2 hover:underline dark:text-ink-300"
          onClick={() => {
            void api.post("/announcements/read-all").then(() => {
              setPage(1);
              setUnreadOnly(false);
              setReload((value) => value + 1);
              window.dispatchEvent(new CustomEvent("openconduit:announcement-read"));
            });
          }}
        >
          {copy.markAll}
        </button>
      </header>

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <FilterChip active={!unreadOnly && !category} onClick={() => { setCategory(""); setUnreadOnly(false); setPage(1); }}>{copy.all}</FilterChip>
          <FilterChip active={unreadOnly} onClick={() => { setUnreadOnly(true); setCategory(""); setPage(1); }}>{copy.unread}</FilterChip>
          {categories.map((item) => (
            <FilterChip key={item.id} active={category === item.slug && !unreadOnly} onClick={() => { setCategory(item.slug); setUnreadOnly(false); setPage(1); }}>
              {item.name}
            </FilterChip>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">{copy.search}</span>
          <input
            value={q}
            onChange={(event) => { setQ(event.target.value); setPage(1); }}
            placeholder={copy.search}
            className="min-h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 outline-none ring-brand-500 focus:ring-2 dark:border-soft-border dark:bg-ink-900 dark:text-ink-50"
          />
        </label>
      </div>

      {data && data.unreadCount === 0 && data.total > 0 && !unreadOnly ? (
        <p className="mt-6 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700 dark:border-soft-border dark:bg-ink-900 dark:text-ink-200">
          <span className="font-semibold">{copy.allRead}</span>
          <span className="mt-1 block text-ink-500 dark:text-ink-400">{copy.allReadBody}</span>
        </p>
      ) : null}

      {error ? <p className="mt-6 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}

      <div className="mt-6 space-y-4">
        {loading && !data ? <p className="text-sm text-ink-500">{locale === "en" ? "Loading…" : "Carregando…"}</p> : null}
        {data && data.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink-200 px-6 py-14 text-center dark:border-soft-border">
            <Newspaper className="mx-auto h-8 w-8 text-ink-400" aria-hidden />
            <p className="mt-4 text-base font-semibold text-ink-900 dark:text-ink-50">{copy.emptyTitle}</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-500 dark:text-ink-400">{copy.emptyBody}</p>
          </div>
        ) : null}
        {data?.items.map((item) => (
          <AnnouncementCard key={item.id} item={item} copy={copy} locale={locale} />
        ))}
      </div>

      {data && data.total > data.pageSize ? (
        <div className="mt-6 flex items-center justify-between">
          <button type="button" className="min-h-11 px-2 text-sm font-medium disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            {copy.previous}
          </button>
          <span className="text-xs text-ink-500">{page} / {pages}</span>
          <button type="button" className="min-h-11 px-2 text-sm font-medium disabled:opacity-40" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
            {copy.next}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active
        ? "min-h-11 shrink-0 rounded-full bg-ink-900 px-3 text-sm font-medium text-white dark:bg-ink-100 dark:text-ink-900"
        : "min-h-11 shrink-0 rounded-full border border-ink-200 px-3 text-sm text-ink-700 dark:border-soft-border dark:text-ink-200"}
    >
      {children}
    </button>
  );
}
