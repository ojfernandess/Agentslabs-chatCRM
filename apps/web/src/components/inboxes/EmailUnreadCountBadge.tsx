import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "@/components/Motion";

export type EmailUnreadCountBadgeVariant = "sidebar-expanded" | "sidebar-collapsed" | "folder";

type Props = {
  count: number;
  title: string;
  variant: EmailUnreadCountBadgeVariant;
  className?: string;
};

const springPop = { type: "spring" as const, stiffness: 520, damping: 26 };

export function EmailUnreadCountBadge({ count, title, variant, className }: Props) {
  const reduceMotion = useReducedMotion();
  const display = count > 99 ? "99+" : String(count);

  const presenceMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : {
        initial: { opacity: 0, scale: 0.55 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.55 },
        transition: springPop,
      };

  if (variant === "sidebar-collapsed") {
    return (
      <AnimatePresence mode="popLayout">
        {count > 0 ? (
          <motion.span
            key="email-unread-dot"
            className={clsx("absolute -right-0.5 -top-0.5 flex h-2 w-2", className)}
            title={title}
            aria-label={title}
            role="status"
            aria-live="polite"
            {...presenceMotion}
          >
            {!reduceMotion ? (
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75 motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            <span
              className="relative inline-flex h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-ink-950"
              aria-hidden
            />
          </motion.span>
        ) : null}
      </AnimatePresence>
    );
  }

  const pillClasses =
    variant === "folder"
      ? "ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white dark:bg-brand-500"
      : "ml-auto shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm dark:bg-brand-500";

  const idlePulse = reduceMotion
    ? undefined
    : {
        scale: [1, 1.06, 1],
        transition: { duration: 2.4, ease: "easeInOut" as const, repeat: Infinity },
      };

  return (
    <AnimatePresence mode="popLayout">
      {count > 0 ? (
        <motion.span
          key="email-unread-pill"
          className={clsx(pillClasses, className)}
          title={title}
          aria-label={title}
          role="status"
          aria-live="polite"
          {...presenceMotion}
        >
          <motion.span className="inline-flex" animate={idlePulse}>
            <motion.span
              key={display}
              className="tabular-nums"
              initial={reduceMotion ? false : { scale: 1.35, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={springPop}
            >
              {display}
            </motion.span>
          </motion.span>
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
