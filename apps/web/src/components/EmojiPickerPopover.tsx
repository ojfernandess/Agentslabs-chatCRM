import { useState, useRef, useLayoutEffect, useEffect, useCallback, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { EMOJI_CATEGORIES, type EmojiCategoryId } from "@/lib/emojiPickerData";

interface Props {
  open: boolean;
  onSelect: (emoji: string) => void;
  categoryLabel: (id: EmojiCategoryId) => string;
  className?: string;
  /** Renders in a body portal positioned relative to the anchor (escapes overflow-hidden parents). */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Exposes the panel element for click-outside handlers when portaled. */
  panelRef?: RefObject<HTMLDivElement | null>;
}

function computePickerPosition(
  anchor: HTMLElement,
  panel: HTMLDivElement | null,
): { top: number; left: number; maxHeight: number } {
  const rect = anchor.getBoundingClientRect();
  const viewportPad = 8;
  const gap = 8;
  const panelWidth = panel?.offsetWidth ?? 288;
  const panelHeight = panel?.offsetHeight ?? 260;
  const spaceAbove = rect.top - viewportPad;
  const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
  const openUp = spaceAbove >= panelHeight || spaceAbove >= spaceBelow;
  const maxHeight = Math.max(120, Math.min(260, openUp ? spaceAbove - gap : spaceBelow - gap));
  const top = openUp
    ? Math.max(viewportPad, rect.top - (panel?.offsetHeight ?? panelHeight) - gap)
    : rect.bottom + gap;
  let left = rect.left;
  if (left + panelWidth > window.innerWidth - viewportPad) {
    left = window.innerWidth - panelWidth - viewportPad;
  }
  left = Math.max(viewportPad, left);
  return { top, left, maxHeight };
}

export function EmojiPickerPopover({
  open,
  onSelect,
  categoryLabel,
  className,
  anchorRef,
  panelRef: externalPanelRef,
}: Props) {
  const [category, setCategory] = useState<EmojiCategoryId>("smileys");
  const panelRef = useRef<HTMLDivElement>(null);

  const assignPanelRef = useCallback(
    (el: HTMLDivElement | null) => {
      panelRef.current = el;
      if (externalPanelRef) externalPanelRef.current = el;
    },
    [externalPanelRef],
  );
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return;
    setPos(computePickerPosition(anchor, panelRef.current));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open || !anchorRef) return;
    updatePosition();
  }, [open, anchorRef, updatePosition, category]);

  useEffect(() => {
    if (!open || !anchorRef) return;
    const onReposition = () => updatePosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, anchorRef, updatePosition]);

  useEffect(() => {
    if (!open || !anchorRef || typeof ResizeObserver === "undefined") return;
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, anchorRef, updatePosition]);

  if (!open) return null;

  const active = EMOJI_CATEGORIES.find((c) => c.id === category) ?? EMOJI_CATEGORIES[0];
  const portaled = Boolean(anchorRef);
  const gridMaxHeight = portaled && pos ? Math.max(80, pos.maxHeight - 44) : undefined;

  const picker = (
    <div
      ref={assignPanelRef}
      className={clsx(
        portaled
          ? "fixed z-[200] w-72 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-600 dark:bg-ink-900"
          : "absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-600 dark:bg-ink-900",
        className,
      )}
      style={
        portaled && pos
          ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
          : undefined
      }
    >
      <div className="flex gap-0.5 overflow-x-auto border-b border-ink-100 p-1 dark:border-ink-800">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={clsx(
              "shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold",
              category === cat.id
                ? "bg-violet-500/15 text-violet-800 dark:text-violet-200"
                : "text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800",
            )}
          >
            {categoryLabel(cat.id)}
          </button>
        ))}
      </div>
      <div
        className="grid grid-cols-8 gap-0.5 overflow-y-auto p-2"
        style={gridMaxHeight ? { maxHeight: gridMaxHeight } : { maxHeight: "11rem" }}
      >
        {active.emojis.map((em) => (
          <button
            key={em}
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
            onClick={() => onSelect(em)}
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );

  if (portaled) {
    return createPortal(picker, document.body);
  }

  return picker;
}
