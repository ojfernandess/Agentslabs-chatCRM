import clsx from "clsx";
import { X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { TransferNotificationContent } from "@/lib/transferNotification";
import {
  TransferNotificationDescription,
  TransferNotificationIcon,
  TransferNotificationMeta,
} from "@/components/workspace/TransferNotificationContent";

type TransferNotificationToastProps = {
  content: TransferNotificationContent;
  createdAt: number;
  onClose: () => void;
};

export function TransferNotificationToast({
  content,
  createdAt,
  onClose,
}: TransferNotificationToastProps) {
  const { t } = useI18n();

  return (
    <div
      role="status"
      className={clsx(
        "pointer-events-auto relative w-[min(calc(100vw-32px),420px)] max-w-[440px] rounded-[11px] border border-ink-200/90 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.10)]",
        "dark:border-soft-border-muted dark:bg-soft-surface-2 dark:shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
      )}
    >
      <button
        type="button"
        onClick={onClose}
        className={clsx(
          "absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition",
          "hover:bg-ink-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
          "dark:text-soft-text-secondary dark:hover:bg-soft-surface-3 dark:hover:text-soft-text",
        )}
        aria-label={t("workspace.transferCloseLabel")}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>

      <div className="flex gap-3 pr-6">
        <TransferNotificationIcon mode={content.mode} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-semibold text-[#1F2937] dark:text-soft-text">{t("workspace.transferTitle")}</p>
          <div className="mt-1.5">
            <TransferNotificationDescription content={content} />
          </div>
          <div className="mt-2">
            <TransferNotificationMeta content={content} createdAt={createdAt} />
          </div>
        </div>
      </div>
    </div>
  );
}
