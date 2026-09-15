import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type Crumb = { label: string; to?: string };

export function HelpBreadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const { t } = useI18n();
  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1 text-sm text-ink-500 dark:text-ink-400">
      <Link to="/help" className="hover:text-brand-600 dark:hover:text-brand-400">
        {t("help.breadcrumb.root")}
      </Link>
      {crumbs.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden />
          {crumb.to ? (
            <Link to={crumb.to} className="hover:text-brand-600 dark:hover:text-brand-400">
              {crumb.label}
            </Link>
          ) : (
            <span className="font-medium text-ink-800 dark:text-ink-200">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
