import {
  Children,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

type Props = {
  moreLabel: string;
  children: ReactNode;
};

const GAP_PX = 8;
const MORE_BUTTON_PX = 140;

/**
 * Keeps the rightmost conversation actions visible and moves the ones that
 * do not fit into "Mais ações". Same buttons and handlers; layout only.
 */
export function ConversationHeaderActionBar({ moreLabel, children }: Props) {
  const items = Children.toArray(children);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [visibleTail, setVisibleTail] = useState(items.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const fit = () => {
      const available = container.clientWidth;
      const widths = Array.from(measure.children).map((el) => (el as HTMLElement).offsetWidth);
      if (widths.length === 0) {
        setVisibleTail(0);
        return;
      }
      const total =
        widths.reduce((sum, width) => sum + width, 0) + GAP_PX * Math.max(0, widths.length - 1);
      if (total <= available + 1) {
        setVisibleTail((prev) => (prev === widths.length ? prev : widths.length));
        return;
      }
      let used = MORE_BUTTON_PX;
      let count = 0;
      for (let index = widths.length - 1; index >= 0; index -= 1) {
        const next = used + GAP_PX + widths[index]!;
        if (next > available) break;
        used = next;
        count += 1;
      }
      const nextTail = Math.max(1, Math.min(widths.length - 1, count));
      setVisibleTail((prev) => (prev === nextTail ? prev : nextTail));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items.length]);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const rect = moreButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menuOpen, visibleTail]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreButtonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (items.length === 0) return null;

  const overflowCount = Math.max(0, items.length - visibleTail);
  const overflow = items.slice(0, overflowCount);
  const visible = items.slice(overflowCount);

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <div
        ref={measureRef}
        inert
        aria-hidden
        className="pointer-events-none fixed top-0 flex w-max gap-2"
        style={{ left: -10000 }}
      >
        {items}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {overflowCount > 0 ? (
          <button
            ref={moreButtonRef}
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200/90 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:bg-slate-700/80"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
            {moreLabel}
          </button>
        ) : null}
        {visible}
      </div>
      {menuOpen && overflow.length > 0 && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="flex w-max min-w-[12rem] max-w-[min(100vw-1rem,22rem)] flex-col items-stretch gap-1 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg dark:border-soft-border dark:bg-[#1B2230]"
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 80 }}
            >
              {overflow.map((item, index) => (
                <div
                  key={index}
                  className="[&>*]:w-full [&>*]:justify-start"
                  onClick={() => setMenuOpen(false)}
                >
                  {item}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
