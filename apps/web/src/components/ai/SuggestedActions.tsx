import clsx from "clsx";
import {
  ArrowRight,
  CalendarPlus,
  Flame,
  Frown,
  Kanban,
  Loader2,
  Sparkles,
  Tag,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n/I18nProvider";

type TagItem = { id: string; name: string; color: string };

type Props = {
  conversationId: string;
  contactId?: string;
  contactTags?: { tag: TagItem }[];
  tags?: TagItem[];
  onApplyTag?: (tagId: string) => void | Promise<void>;
  onGenerateReply: () => void;
  generating: boolean;
  disabled: boolean;
};

const linkActions = [
  { id: "followup", icon: CalendarPlus, labelKey: "aiInsightsPage.actions.followUp", href: "reminders" },
  { id: "funnel", icon: Kanban, labelKey: "aiInsightsPage.actions.moveFunnel", href: "crm" },
  { id: "transfer", icon: UserRound, labelKey: "aiInsightsPage.actions.transfer", href: "conversation" },
] as const;

function ApplyTagAction({
  contactId,
  contactTags,
  tags,
  onApplyTag,
  disabled,
  conversationId,
}: {
  contactId?: string;
  contactTags?: { tag: TagItem }[];
  tags?: TagItem[];
  onApplyTag?: (tagId: string) => void | Promise<void>;
  disabled: boolean;
  conversationId: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const assignedIds = useMemo(
    () => new Set(contactTags?.map((ct) => ct.tag.id) ?? []),
    [contactTags],
  );
  const availableTags = useMemo(
    () => (tags ?? []).filter((tag) => !assignedIds.has(tag.id)),
    [tags, assignedIds],
  );

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [contactId, conversationId]);

  const handleSelect = useCallback(
    async (tagId: string) => {
      if (!onApplyTag) return;
      setApplying(true);
      try {
        await onApplyTag(tagId);
        setOpen(false);
      } finally {
        setApplying(false);
      }
    },
    [onApplyTag],
  );

  const actionDisabled = disabled || !conversationId || !contactId;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={actionDisabled}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 shadow-sm transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900/50 dark:text-ink-100 dark:hover:bg-ink-800/60",
          actionDisabled && "opacity-40",
        )}
      >
        {applying ? <Loader2 className="h-4 w-4 animate-spin text-brand-500" /> : <Tag className="h-4 w-4 text-brand-500" />}
        {t("aiInsightsPage.actions.applyTag")}
      </button>
      {open && !actionDisabled ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900">
          <p className="px-3 py-1.5 text-xs font-medium text-ink-500 dark:text-ink-400">
            {t("contacts.addTag")}
          </p>
          {availableTags.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">
              {tags?.length ? t("conversationDetail.tagNoneAvailable") : t("contacts.noTags")}
            </p>
          ) : (
            availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                disabled={applying}
                onClick={() => void handleSelect(tag.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-50 disabled:opacity-50 dark:text-ink-200 dark:hover:bg-ink-800"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function SuggestedActions({
  conversationId,
  contactId,
  contactTags,
  tags,
  onApplyTag,
  onGenerateReply,
  generating,
  disabled,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={disabled || generating || !conversationId}
        onClick={onGenerateReply}
        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition hover:brightness-110 disabled:opacity-50"
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {t("aiInsightsPage.actions.generateReply")}
      </button>

      <ApplyTagAction
        contactId={contactId}
        contactTags={contactTags}
        tags={tags}
        onApplyTag={onApplyTag}
        disabled={disabled}
        conversationId={conversationId}
      />

      {linkActions.map((action) => {
        const Icon = action.icon;
        const href =
          action.href === "conversation"
            ? `/conversations/${conversationId}`
            : action.href === "crm"
              ? "/crm"
              : "/reminders";

        return (
          <Link
            key={action.id}
            to={href}
            className={clsx(
              "inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 shadow-sm transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900/50 dark:text-ink-100 dark:hover:bg-ink-800/60",
              !conversationId && "pointer-events-none opacity-40",
            )}
          >
            <Icon className="h-4 w-4 text-brand-500" />
            {t(action.labelKey)}
          </Link>
        );
      })}
    </div>
  );
}

export type SmartAlertItem = {
  id: string;
  type: "angry" | "hot" | "waiting" | "opportunity";
  titleKey: string;
  bodyKey: string;
  bodyParams?: Record<string, string>;
  conversationId?: string;
  timeKey: string;
};

const ALERT_STYLE = {
  angry: "border-rose-200/80 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/20",
  hot: "border-orange-200/80 bg-orange-50/80 dark:border-orange-900/40 dark:bg-orange-950/20",
  waiting: "border-amber-200/80 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20",
  opportunity: "border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20",
} as const;

const ALERT_ICON = {
  angry: Frown,
  hot: Flame,
  waiting: CalendarPlus,
  opportunity: Sparkles,
} as const;

type SmartAlertsProps = {
  alerts: SmartAlertItem[];
};

export function SmartAlerts({ alerts }: SmartAlertsProps) {
  const { t } = useI18n();

  if (alerts.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">{t("aiInsightsPage.smartAlertsTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {alerts.map((alert) => {
          const Icon = ALERT_ICON[alert.type];
          const body = alert.bodyParams
            ? t(alert.bodyKey).replace(/\{(\w+)\}/g, (_, k) => alert.bodyParams?.[k] ?? "")
            : t(alert.bodyKey);
          return (
            <div
              key={alert.id}
              className={clsx("rounded-2xl border p-4 shadow-sm transition hover:shadow-md", ALERT_STYLE[alert.type])}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 dark:bg-ink-900/50">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-900 dark:text-ink-50">{t(alert.titleKey)}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600 dark:text-ink-400">{body}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-ink-500">{t(alert.timeKey)}</span>
                    {alert.conversationId ? (
                      <Link
                        to={`/conversations/${alert.conversationId}`}
                        className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t("aiInsightsPage.viewConversation")}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
