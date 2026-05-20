import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Props = {
  children: React.ReactNode;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  minWidth?: number;
};

/** Dropdown ancorado ao botão, renderizado em document.body (evita corte por overflow da tabela). */
export function FixedDropdownPortal({ children, onClose, anchorRef, minWidth = 192 }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - minWidth - 8));
    setPos({ top: r.bottom + 4, left });
  }, [anchorRef, minWidth]);

  useEffect(() => {
    const onScroll = () => onClose();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div ref={panelRef} className="fixed z-[250]" style={{ top: pos.top, left: pos.left, minWidth }}>
      {children}
    </div>,
    document.body,
  );
}
