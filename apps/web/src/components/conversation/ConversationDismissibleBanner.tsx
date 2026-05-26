import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  dismissConversationBanner,
  dismissUserBanner,
  isConversationBannerDismissed,
  isUserBannerDismissed,
  type ConversationBannerKey,
  type UserBannerKey,
} from "@/lib/conversationBannerDismiss";

type BannerVariant = "danger" | "violet" | "info";

const variantClasses: Record<BannerVariant, string> = {
  danger:
    "border-red-200/90 bg-red-50/95 text-red-950 dark:border-red-800/50 dark:bg-red-950/45 dark:text-red-100",
  violet:
    "border-violet-200/80 bg-violet-50/90 text-violet-950 dark:border-violet-800/40 dark:bg-violet-950/40 dark:text-violet-100",
  info: "border-sky-200/80 bg-sky-50/90 text-sky-950 dark:border-sky-800/50 dark:bg-sky-950/40 dark:text-sky-100",
};

type ConversationDismissibleBannerProps = {
  variant: BannerVariant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Barra acima da área de mensagens (não fixa, fora do scroll). */
  strip?: boolean;
} & (
  | { scope: "conversation"; conversationId: string; bannerKey: ConversationBannerKey }
  | { scope: "user"; bannerKey: UserBannerKey }
);

export function ConversationDismissibleBanner(props: ConversationDismissibleBannerProps) {
  const { t } = useI18n();
  const { variant, icon, children, className, strip = false } = props;
  const conversationId = props.scope === "conversation" ? props.conversationId : null;
  const bannerKey = props.bannerKey;

  const readDismissed = () =>
    props.scope === "conversation"
      ? isConversationBannerDismissed(conversationId!, bannerKey as ConversationBannerKey)
      : isUserBannerDismissed(bannerKey as UserBannerKey);

  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    setDismissed(readDismissed());
  }, [props.scope, conversationId, bannerKey]);

  if (dismissed) return null;

  const handleDismiss = () => {
    if (props.scope === "conversation") {
      dismissConversationBanner(conversationId!, bannerKey as ConversationBannerKey);
    } else {
      dismissUserBanner(bannerKey as UserBannerKey);
    }
    setDismissed(true);
  };

  const banner = (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-sm",
        variantClasses[variant],
        className,
      )}
      role="status"
    >
      {icon ? (
        <span className="mt-0.5 shrink-0" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
      <button
        type="button"
        onClick={handleDismiss}
        className="-mr-0.5 -mt-0.5 shrink-0 rounded-lg p-1 opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        aria-label={t("common.close")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  if (!strip) return banner;

  return (
    <div className="shrink-0 border-b border-ink-100/80 bg-white/70 px-3 py-2.5 backdrop-blur-sm dark:border-white/10 dark:bg-[#0F1B2B]/45 sm:px-5">
      {banner}
    </div>
  );
}
