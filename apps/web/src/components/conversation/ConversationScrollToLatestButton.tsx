import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { AnimatePresence, motion } from "@/components/Motion";

type ConversationScrollToLatestButtonProps = {
  visible: boolean;
  label: string;
  onClick: () => void;
  className?: string;
};

export function ConversationScrollToLatestButton({
  visible,
  label,
  onClick,
  className,
}: ConversationScrollToLatestButtonProps) {
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          className={clsx(
            "pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center",
            className,
          )}
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.92 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            className={clsx(
              "pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full",
              "border border-brand-400/35 bg-brand-500 text-white shadow-lg shadow-brand-500/30 backdrop-blur-sm",
              "transition-[transform,box-shadow,background-color,border-color] duration-200",
              "hover:scale-[1.04] hover:border-brand-300/50 hover:bg-brand-600 hover:shadow-xl hover:shadow-brand-500/35",
              "active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              "dark:border-brand-300/30 dark:bg-brand-500/95 dark:text-white dark:shadow-brand-500/25 dark:ring-1 dark:ring-white/10",
              "dark:hover:border-brand-200/40 dark:bg-brand-400 dark:shadow-brand-400/30",
            )}
          >
            <ChevronDown className="h-5 w-5" strokeWidth={2.35} aria-hidden />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
