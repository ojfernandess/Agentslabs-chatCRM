import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import clsx from "clsx";
import { isMetaFetchFailedError, isMetaMarketingFrequencyCapError } from "@openconduit/shared";
import { useI18n } from "@/i18n";

type Props = {
  providerError?: string | null;
  className?: string;
};

export function MessageFailedDeliveryHint({ providerError, className }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const is131049 = isMetaMarketingFrequencyCapError(providerError);
  const isFetchFailed = isMetaFetchFailedError(providerError);
  const hintTitle = is131049
    ? t("conversationDetail.deliveryError131049Title")
    : isFetchFailed
      ? t("conversationDetail.deliveryErrorFetchFailedTitle")
      : t("conversationDetail.deliveryErrorGenericTitle");
  const hintSummary = is131049
    ? t("conversationDetail.deliveryError131049Summary")
    : isFetchFailed
      ? t("conversationDetail.deliveryErrorFetchFailedSummary")
      : t("conversationDetail.deliveryErrorGenericSummary");
  const actions = is131049
    ? [
        t("conversationDetail.deliveryError131049Action1"),
        t("conversationDetail.deliveryError131049Action2"),
        t("conversationDetail.deliveryError131049Action3"),
      ]
    : isFetchFailed
      ? [
          t("conversationDetail.deliveryErrorFetchFailedAction1"),
          t("conversationDetail.deliveryErrorFetchFailedAction2"),
        ]
      : [
          t("conversationDetail.deliveryErrorGenericAction1"),
          t("conversationDetail.deliveryErrorGenericAction2"),
        ];

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const panelW = 280;
    const gap = 6;
    let left = rect.right - panelW;
    left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
    const top = Math.max(8, rect.top - gap);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={clsx(
          "inline-flex items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
          className,
        )}
        aria-label={hintTitle}
        title={t("conversationDetail.deliveryErrorClickHint")}
        onClick={() => setOpen((v) => !v)}
      >
        <AlertTriangle className="crm-bubble-read-status is-failed h-[18px] w-[18px]" aria-hidden />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[200] w-[min(100vw-16px,280px)] rounded-lg border border-rose-200 bg-white p-3 text-left shadow-lg dark:border-rose-900/50 dark:bg-ink-950"
              style={{ top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
              role="dialog"
              aria-label={hintTitle}
            >
              <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">{hintTitle}</p>
              <p className="mt-1.5 text-xs leading-snug text-ink-700 dark:text-ink-300">{hintSummary}</p>
              {providerError?.trim() ? (
                <p className="mt-2 rounded bg-rose-50 px-2 py-1 font-mono text-[10px] leading-snug text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
                  {providerError.trim()}
                </p>
              ) : null}
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-600 dark:text-ink-400">
                {actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
