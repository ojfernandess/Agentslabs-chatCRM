import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import clsx from "clsx";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "default",
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          role="presentation"
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-ink-700 dark:bg-ink-900"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-ink-50">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-ink-400">{message}</p>
            {error ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={onCancel}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
              >
                {cancelLabel ?? t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={onConfirm}
                className={clsx(
                  "rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50",
                  variant === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-brand-500 hover:bg-brand-600",
                )}
              >
                {loading ? t("common.saving") : (confirmLabel ?? t("common.confirm"))}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
