import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Outlet, useMatch } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import {
  conversationsSplitViewGridClass,
  parseConversationsSplitViewSize,
  type ConversationsSplitViewSize,
} from "@/lib/conversationSplitView";
import { ConversationsPage } from "@/pages/ConversationsPage";

export type ConversationsOutletContext = {
  refreshList: () => Promise<void>;
};

export function ConversationsLayout() {
  const activeThreadMatch = useMatch("/conversations/:id");
  const activeThreadId = activeThreadMatch?.params.id;
  const refreshListRef = useRef<(() => Promise<void>) | null>(null);
  const [splitViewSize, setSplitViewSize] = useState<ConversationsSplitViewSize>("default");

  const refreshList = useCallback(() => refreshListRef.current?.() ?? Promise.resolve(), []);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ conversationsSplitViewSize?: string }>("/settings/channel")
      .then((res) => {
        if (!cancelled) setSplitViewSize(parseConversationsSplitViewSize(res.conversationsSplitViewSize));
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/*
        Desktop: largura da fila conforme preferência da organização.
        Mobile (<lg): coluna única — comportamento inalterado.
      */}
      <div
        className={clsx(
          "grid min-h-0 min-w-0 flex-1 grid-cols-1",
          conversationsSplitViewGridClass(splitViewSize),
        )}
      >
        <aside
          className={clsx(
            "flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-ink-200 bg-white dark:border-ink-800 dark:bg-[#0F1B2B] lg:border-b-0 lg:border-r",
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
            "flex min-h-0 min-w-0 flex-col overflow-hidden",
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
