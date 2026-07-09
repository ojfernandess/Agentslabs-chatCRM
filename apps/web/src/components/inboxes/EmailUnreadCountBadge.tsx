import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "@/components/Motion";

export type EmailUnreadCountBadgeVariant = "sidebar-expanded" | "sidebar-collapsed" | "folder";

type Props = {
  count: number;
  title: string;
  variant: EmailUnreadCountBadgeVariant;
  className?: string;
};

const softEase = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as const };

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
        initial: { opacity: 0, scale: 0.85 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.85 },
        transition: softEase,
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
                className="email-unread-dot-ripple absolute inline-flex h-full w-full rounded-full bg-brand-400"
                aria-hidden
              />
            ) : null}
            <span
              className={clsx(
                "relative inline-flex h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-ink-950",
                !reduceMotion && "email-unread-dot-breathe",
              )}
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

  return (
    <AnimatePresence mode="popLayout">
      {count > 0 ? (
        <motion.span
          key="email-unread-pill"
          className={clsx(pillClasses, !reduceMotion && "email-unread-badge-pulse", className)}
          title={title}
          aria-label={title}
          role="status"
          aria-live="polite"
          {...presenceMotion}
        >
          <motion.span
            key={display}
            className="tabular-nums"
            initial={reduceMotion ? false : { opacity: 0.6 }}
            animate={{ opacity: 1 }}
            transition={softEase}
          >
            {display}
          </motion.span>
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
