import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type BillingHorizontalCardRowProps = {
  itemCount: number;
  scrollThreshold: number;
  gridClassName: string;
  scrollGapClassName?: string;
  scrollItemClassName?: string;
  ariaLabelPrev?: string;
  ariaLabelNext?: string;
  children: ReactNode;
};

export function BillingHorizontalCardRow({
  itemCount,
  scrollThreshold,
  gridClassName,
  scrollGapClassName = "gap-6 lg:gap-8",
  scrollItemClassName = "w-[min(100%,320px)] shrink-0 sm:w-[300px]",
  ariaLabelPrev = "Previous",
  ariaLabelNext = "Next",
  children,
}: BillingHorizontalCardRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const useCarousel = itemCount >= scrollThreshold;

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(maxScroll > 4 && el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    if (!useCarousel) return;
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      observer.disconnect();
    };
  }, [useCarousel, updateScrollState, itemCount]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.82, 260);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  if (!useCarousel) {
    return <div className={gridClassName}>{children}</div>;
  }

  const arrowButtonClass =
    "absolute top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200/90 bg-white/95 text-ink-700 shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur-sm transition hover:border-brand-300 hover:text-brand-600 hover:shadow-[0_10px_28px_rgba(103,52,255,0.18)] dark:border-soft-border dark:bg-ink-900/90 dark:text-ink-100 dark:hover:border-brand-500/50 dark:hover:text-brand-300";

  return (
    <div className="relative">
      {canScrollLeft ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-14 bg-gradient-to-r from-white via-white/90 to-transparent dark:from-ink-950 dark:via-ink-950/80"
          />
          <button
            type="button"
            aria-label={ariaLabelPrev}
            onClick={() => scrollByPage(-1)}
            className={clsx(arrowButtonClass, "left-0 sm:-left-3")}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </>
      ) : null}

      {canScrollRight ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-white via-white/90 to-transparent dark:from-ink-950 dark:via-ink-950/80"
          />
          <button
            type="button"
            aria-label={ariaLabelNext}
            onClick={() => scrollByPage(1)}
            className={clsx(arrowButtonClass, "right-0 sm:-right-3")}
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </>
      ) : null}

      <div
        ref={scrollRef}
        className={clsx(
          "flex overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] snap-x snap-mandatory [&::-webkit-scrollbar]:hidden",
          scrollGapClassName,
        )}
      >
        {Children.map(children, (child, index) => (
          <div key={index} className={clsx("snap-start", scrollItemClassName)}>
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
