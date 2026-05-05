import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useConversationAlerts } from "@/hooks/useConversationAlerts";
import { useI18n } from "@/i18n/I18nProvider";
import clsx from "clsx";

export function ConversationNotifyBell() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { badgeCount, clearBadge, requestDesktopPermission } = useConversationAlerts();

  return (
    <div className="space-y-1.5 border-t border-gray-100 px-3 py-3">
      <button
        type="button"
        onClick={() => {
          clearBadge();
          navigate("/conversations");
        }}
        className={clsx(
          "relative flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors",
          badgeCount > 0
            ? "border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100"
            : "border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900",
        )}
        title={t("nav.alerts")}
      >
        <Bell className={clsx("h-5 w-5", badgeCount > 0 && "animate-pulse")} />
        <span>{t("nav.alerts")}</span>
        {badgeCount > 0 && (
          <span className="absolute right-2 top-1/2 flex h-5 min-w-[1.25rem] -translate-y-1/2 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>
      {typeof Notification !== "undefined" && Notification.permission === "default" && (
        <button
          type="button"
          onClick={() => void requestDesktopPermission()}
          className="w-full rounded-lg py-1 text-center text-[11px] text-brand-600 hover:text-brand-800"
        >
          {t("nav.enableDesktopNotifications")}
        </button>
      )}
    </div>
  );
}
