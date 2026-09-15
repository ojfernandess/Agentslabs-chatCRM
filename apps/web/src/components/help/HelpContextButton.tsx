import { CircleHelp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  articleSlug: string;
  label?: string;
  className?: string;
};

/** Contextual ? button — opens article in /help */
export function HelpContextButton({ articleSlug, label, className }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const aria = label ?? t("nav.help");
  return (
    <button
      type="button"
      aria-label={aria}
      title={aria}
      onClick={() => navigate(`/help/${articleSlug}`)}
      className={
        className ??
        "rounded-full p-0.5 text-ink-400 transition-colors hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:hover:text-brand-400"
      }
    >
      <CircleHelp className="h-4 w-4" aria-hidden />
    </button>
  );
}
