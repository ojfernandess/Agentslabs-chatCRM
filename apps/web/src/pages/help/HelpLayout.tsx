import { useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ChevronDown, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import { HELP_CATEGORIES } from "@/lib/help/categories";
import { isCategoryVisible, searchHelpArticles } from "@/lib/help/search";
import { useHelpConfig } from "@/lib/help/useHelpConfig";

const RECENT_KEY = "help_recent_slugs";

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function pushRecentSlug(slug: string) {
  try {
    const prev = readRecent().filter((s) => s !== slug);
    localStorage.setItem(RECENT_KEY, JSON.stringify([slug, ...prev].slice(0, 8)));
  } catch {
    /* ignore */
  }
}

export function HelpLayout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { config } = useHelpConfig();
  const [search, setSearch] = useState("");
  const [mobileCatOpen, setMobileCatOpen] = useState(false);

  const ctx = useMemo(
    () => ({
      isAdmin: isTenantAdmin(user?.role, user?.actingOrganizationId),
      features: user?.organizationFeatures ?? {},
    }),
    [user],
  );

  const visibleCategories = HELP_CATEGORIES.filter((c) => isCategoryVisible(c, ctx)).sort(
    (a, b) => a.order - b.order,
  );

  const searchResults = search.trim() ? searchHelpArticles(search.trim(), ctx).slice(0, 8) : [];

  const isHome = location.pathname === "/help" || location.pathname === "/help/";

  return (
    <div className="min-h-full bg-gradient-to-b from-ink-50/80 to-white dark:from-ink-950 dark:to-ink-900">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("help.backToApp")}
          </button>
        </div>

        <header className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl dark:text-white">
            {config.guide.title}
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-ink-600 sm:text-base dark:text-ink-400">
            {config.guide.description}
          </p>

          <div className="relative mx-auto mt-6 max-w-xl">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("help.searchPlaceholder")}
              className="w-full rounded-2xl border border-ink-200 bg-white py-3.5 pl-12 pr-4 text-sm shadow-sm outline-none ring-brand-500/30 focus:ring-2 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
              aria-label={t("help.searchPlaceholder")}
            />
            {searchResults.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-lg dark:border-ink-700 dark:bg-ink-800">
                <p className="border-b border-ink-100 px-4 py-2 text-xs font-semibold text-ink-500 dark:border-ink-700">
                  {t("help.searchResults").replace("{query}", search.trim())}
                </p>
                <ul>
                  {searchResults.map(({ article, category }) => (
                    <li key={article.slug}>
                      <Link
                        to={`/help/${article.slug}`}
                        onClick={() => setSearch("")}
                        className="block px-4 py-3 hover:bg-ink-50 dark:hover:bg-ink-700/50"
                      >
                        <span className="block text-sm font-medium text-ink-900 dark:text-ink-50">{article.title}</span>
                        <span className="text-xs text-ink-500">{category.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : search.trim() ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl border border-ink-200 bg-white p-4 text-sm text-ink-500 shadow-lg dark:border-ink-700 dark:bg-ink-800">
                {t("help.searchEmpty").replace("{query}", search.trim())}
              </div>
            ) : null}
          </div>
        </header>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* Mobile category picker */}
          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => setMobileCatOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-medium dark:border-ink-700 dark:bg-ink-800"
            >
              {t("help.categories")}
              <ChevronDown className={clsx("h-4 w-4 transition-transform", mobileCatOpen && "rotate-180")} />
            </button>
            {mobileCatOpen ? (
              <nav className="mt-2 space-y-1 rounded-xl border border-ink-200 bg-white p-2 dark:border-ink-700 dark:bg-ink-800">
                {visibleCategories.map((cat) => (
                  <Link
                    key={cat.id}
                    to={cat.slug === "getting-started" && isHome ? "/help" : `/help/${cat.slug}`}
                    onClick={() => setMobileCatOpen(false)}
                    className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-700"
                  >
                    {cat.title}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden w-56 shrink-0 lg:block xl:w-64">
            <nav className="sticky top-6 space-y-1 rounded-2xl border border-ink-200 bg-white/80 p-3 backdrop-blur dark:border-ink-700 dark:bg-ink-900/60">
              <p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-ink-500">{t("help.categories")}</p>
              {visibleCategories.map((cat) => {
                const to = cat.slug === "getting-started" ? "/help/getting-started" : `/help/${cat.slug}`;
                const active = location.pathname.includes(`/help/${cat.slug}`);
                return (
                  <Link
                    key={cat.id}
                    to={to}
                    className={clsx(
                      "block rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                        : "text-ink-700 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
                    )}
                  >
                    {cat.title}
                  </Link>
                );
              })}
            </nav>
          </aside>

          <main className="min-w-0 flex-1">
            <Outlet context={{ ctx, config }} />
          </main>
        </div>
      </div>
    </div>
  );
}

export type HelpOutletContext = {
  ctx: { isAdmin: boolean; features: Record<string, boolean | undefined> };
  config: ReturnType<typeof useHelpConfig>["config"];
};
