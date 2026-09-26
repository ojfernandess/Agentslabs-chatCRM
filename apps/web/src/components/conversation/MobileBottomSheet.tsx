import type { ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";

type MobileBottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
};

export function MobileBottomSheet({ open, onClose, title, children, className }: MobileBottomSheetProps) {
  const { t } = useI18n();

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
            className={clsx(
              "w-full max-h-[min(85dvh,560px)] overflow-hidden rounded-t-2xl border border-ink-200/80 bg-white shadow-2xl dark:border-soft-border dark:bg-[#151826]",
              "pb-[env(safe-area-inset-bottom)]",
              className,
            )}
            onClick={(e) => e.stopPropagation()}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80) onClose();
            }}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-ink-300 dark:bg-ink-600" aria-hidden />
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-soft-border">
              <p className="text-base font-semibold text-ink-900 dark:text-ink-50">{title}</p>
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-ink-100"
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[min(70dvh,480px)] overflow-y-auto overscroll-contain">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

type MobileBottomSheetActionProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

export function MobileBottomSheetAction({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: MobileBottomSheetActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium transition-colors disabled:opacity-40",
        destructive
          ? "text-red-600 hover:bg-red-50 active:bg-red-100 dark:text-red-400 dark:hover:bg-red-950/30"
          : "text-ink-800 hover:bg-ink-50 active:bg-ink-100 dark:text-ink-100 dark:hover:bg-white/5",
      )}
    >
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          destructive ? "bg-red-100 dark:bg-red-950/40" : "bg-ink-100 dark:bg-white/10",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
}
