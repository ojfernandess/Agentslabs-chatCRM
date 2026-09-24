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
    <AnimatePresence>
      {visible ? (
        <motion.div
          className={clsx(
            "pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center",
            className,
          )}
          initial={{ opacity: 0, y: 10, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.94 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            className={clsx(
              "pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full",
              "border border-ink-200/70 bg-white/92 text-ink-600 shadow-lg shadow-ink-900/10 backdrop-blur-md",
              "transition-[transform,box-shadow,background-color,color] duration-200",
              "hover:scale-[1.04] hover:border-brand-300/60 hover:bg-white hover:text-brand-600 hover:shadow-xl hover:shadow-brand-500/15",
              "active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              "dark:border-white/10 dark:bg-[#151826]/88 dark:text-ink-200 dark:shadow-black/35",
              "dark:hover:border-brand-400/30 dark:hover:bg-[#1a2030] dark:hover:text-brand-300 dark:hover:shadow-brand-500/10",
            )}
          >
            <ChevronDown className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
