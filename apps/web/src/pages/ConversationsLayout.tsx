import { useCallback, useRef } from "react";
import clsx from "clsx";
import { Outlet, useMatch } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ConversationsPage } from "@/pages/ConversationsPage";

export type ConversationsOutletContext = {
  refreshList: () => Promise<void>;
};

export function ConversationsLayout() {
  const activeThreadMatch = useMatch("/conversations/:id");
  const activeThreadId = activeThreadMatch?.params.id;
  const refreshListRef = useRef<(() => Promise<void>) | null>(null);

  const refreshList = useCallback(() => refreshListRef.current?.() ?? Promise.resolve(), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
        <aside
          className={clsx(
            "flex min-h-0 flex-col border-b border-ink-200 bg-white dark:border-ink-800 dark:bg-[#0F1B2B] lg:border-b-0 lg:border-r",
            activeThreadId && "hidden lg:flex",
          )}
        >
          <ConversationsPage
            splitView
            onRegisterRefresh={(fn) => {
              refreshListRef.current = fn;
            }}
          />
        </aside>
        <main
          className={clsx(
            "flex min-h-0 min-w-0 flex-col",
            !activeThreadId && "hidden lg:flex",
          )}
        >
          <Outlet context={{ refreshList }} />
        </main>
      </div>
    </div>
  );
}

export function ConversationsThreadPlaceholder() {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-ink-50 p-8 text-center dark:bg-[#0E1624]">
      <MessageSquare className="mb-3 h-12 w-12 text-brand-500/70" />
      <p className="text-sm font-medium text-ink-800 dark:text-ink-100">
        {t("conversations.selectThread")}
      </p>
      <p className="mt-1 max-w-sm text-xs text-ink-500">{t("conversations.selectThreadHint")}</p>
    </div>
  );
}
