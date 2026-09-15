import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "@/components/Motion";
import { backdropVariants, modalVariants } from "@/components/Motion";
import { BookOpen, ChevronRight, CircleHelp, MessageCircle, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { useHelpConfig } from "@/lib/help/useHelpConfig";
import { getContextualArticles, getContextLabel } from "@/lib/help/routeContext";
import { HELP_FAQ_SLUGS, getArticleBySlug } from "@/lib/help/articles";
import { isArticleVisible } from "@/lib/help/search";
import { HelpSupportPanel } from "./HelpSupportPanel";

type View = "main" | "support";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function HelpModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { config } = useHelpConfig();
  const [view, setView] = useState<View>("main");
  const dialogRef = useRef<HTMLDivElement>(null);

  const ctx = {
    isAdmin: isTenantAdmin(user?.role, user?.actingOrganizationId),
    features: user?.organizationFeatures ?? {},
  };

  const contextLabel = getContextLabel(location.pathname);
  const contextualArticles = getContextualArticles(location.pathname, ctx);

  useEffect(() => {
    if (!open) {
      setView("main");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open, view]);

  const openGuide = () => {
    onClose();
    navigate("/help");
  };

  const openArticle = (slug: string) => {
    onClose();
    navigate(`/help/${slug}`);
  };

  const faqArticles = HELP_FAQ_SLUGS.map((s) => getArticleBySlug(s)).filter(
    (a) => a && isArticleVisible(a, ctx),
  );

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4 dark:bg-black/60"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-modal-title"
            tabIndex={-1}
            className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-ink-200 bg-white shadow-2xl sm:rounded-2xl dark:border-ink-700 dark:bg-ink-900"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 justify-end px-4 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto px-6 pb-6">
              {view === "support" ? (
                <HelpSupportPanel
                  config={config}
                  contextLabel={contextLabel}
                  onBack={() => setView("main")}
                />
              ) : (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400">
                      <CircleHelp className="h-7 w-7" aria-hidden />
                    </div>
                    <h2 id="help-modal-title" className="mt-4 text-xl font-bold text-ink-900 dark:text-ink-50">
                      {t("help.modal.title")}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
                      {t("help.modal.subtitle")}
                    </p>
                  </div>

                  {config.guide.enabled ? (
                    <button
                      type="button"
                      onClick={openGuide}
                      className="flex w-full items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:border-ink-700 dark:bg-ink-800/50 dark:hover:border-brand-700 dark:hover:bg-brand-950/20"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                        <BookOpen className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink-900 dark:text-ink-50">{t("help.modal.guideTitle")}</span>
                        <span className="mt-0.5 block text-sm text-ink-500 dark:text-ink-400">{config.guide.description}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
                    </button>
                  ) : null}

                  {config.support.enabled ? (
                    <button
                      type="button"
                      onClick={() => setView("support")}
                      className="flex w-full items-center gap-4 rounded-2xl border border-ink-200 bg-white p-4 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-ink-700 dark:bg-ink-800/50 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/20"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                        <MessageCircle className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-ink-900 dark:text-ink-50">{config.support.title}</span>
                        <span className="mt-0.5 block text-sm text-ink-500 dark:text-ink-400">{t("help.modal.supportHint")}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-ink-400" />
                    </button>
                  ) : null}

                  {contextualArticles.length > 0 ? (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-ink-500">
                        {contextLabel
                          ? t("help.modal.contextTitle").replace("{module}", contextLabel)
                          : t("help.modal.relatedTitle")}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {contextualArticles.map((a) => (
                          <li key={a.slug}>
                            <button
                              type="button"
                              onClick={() => openArticle(a.slug)}
                              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                            >
                              {a.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {faqArticles.length > 0 ? (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-ink-500">{t("help.modal.faqTitle")}</p>
                      <ul className="mt-2 space-y-1">
                        {faqArticles.map((a) =>
                          a ? (
                            <li key={a.slug}>
                              <button
                                type="button"
                                onClick={() => openArticle(a.slug)}
                                className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-700 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                              >
                                {a.title}
                              </button>
                            </li>
                          ) : null,
                        )}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
