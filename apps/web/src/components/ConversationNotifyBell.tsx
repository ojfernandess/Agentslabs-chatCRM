import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ConversationAlertPreview } from "@/hooks/useConversationAlerts";
import { useI18n } from "@/i18n/I18nProvider";
import clsx from "clsx";

export interface ConversationNotifyBellProps {
  badgeCount: number;
  alertPreviews: ConversationAlertPreview[];
  clearBadge: () => void;
}

const PANEL_W = 320;
const GAP = 8;
const MARGIN = 12;
/** Altura máxima total do painel (lista + rodapé “Ver todas”). */
const PANEL_MAX = 380;
const MIN_USEFUL_SPACE = 96;

/**
 * Ancora o painel ao sino: abaixo quando há espaço; por cima quando o sino está no fundo do ecrã.
 * Evita o clamp antigo (`min(top, vh - estHeight)`) que deslocava o painel para o fundo da viewport,
 * longe do ícone.
 */
function computePanelPosition(
  anchor: DOMRect,
  panelHeight?: number,
): { top: number; left: number; width: number; maxHeight: number; placement: "above" | "below" } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(PANEL_W, vw - MARGIN * 2);
  let left = anchor.right - width;
  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));

  const spaceBelow = vh - anchor.bottom - GAP - MARGIN;
  const spaceAbove = anchor.top - GAP - MARGIN;

  let top: number;
  let maxHeight: number;
  let placement: "above" | "below";

  if (spaceBelow >= MIN_USEFUL_SPACE) {
    top = anchor.bottom + GAP;
    maxHeight = Math.min(PANEL_MAX, spaceBelow);
    placement = "below";
  } else if (spaceAbove >= MIN_USEFUL_SPACE) {
    maxHeight = Math.min(PANEL_MAX, spaceAbove);
    placement = "above";
    const effectiveH = panelHeight != null ? Math.min(panelHeight, maxHeight) : maxHeight;
    top = anchor.top - GAP - effectiveH;
    if (top < MARGIN) {
      const shift = MARGIN - top;
      top = MARGIN;
      maxHeight = Math.max(MIN_USEFUL_SPACE, maxHeight - shift);
    }
  } else {
    if (spaceAbove >= spaceBelow) {
      maxHeight = Math.max(72, Math.min(PANEL_MAX, spaceAbove));
      placement = "above";
      const effectiveH = panelHeight != null ? Math.min(panelHeight, maxHeight) : maxHeight;
      top = anchor.top - GAP - effectiveH;
      top = Math.max(MARGIN, top);
    } else {
      top = anchor.bottom + GAP;
      maxHeight = Math.max(72, Math.min(PANEL_MAX, spaceBelow));
      placement = "below";
    }
  }

  return { top, left, width, maxHeight, placement };
}

export function ConversationNotifyBell({ badgeCount, alertPreviews, clearBadge }: ConversationNotifyBellProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "above" | "below";
  }>({ top: 0, left: 0, width: PANEL_W, maxHeight: PANEL_MAX, placement: "below" });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const h = panelRef.current?.getBoundingClientRect().height;
    setPos(computePanelPosition(anchor.getBoundingClientRect(), h));
  }, [open, alertPreviews.length]);

  useEffect(() => {
    if (!open) return;
    const on = () => {
      const el = anchorRef.current;
      if (!el) return;
      const h = panelRef.current?.getBoundingClientRect().height;
      setPos(computePanelPosition(el.getBoundingClientRect(), h));
    };
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (anchorRef.current?.contains(node)) return;
      if (document.getElementById("openconduit-notify-panel")?.contains(node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const panel = open ? (
    <div
      id="openconduit-notify-panel"
      role="menu"
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
      ref={panelRef}
      className={clsx(
        "fixed z-[1000] flex flex-col overflow-hidden rounded-xl border shadow-xl",
        "border-ink-200 bg-white dark:border-ink-600 dark:bg-ink-800",
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {alertPreviews.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-ink-500 dark:text-ink-400">
            {t("conversationAlerts.empty")}
          </p>
        ) : (
          alertPreviews.map((row) => (
            <button
              key={row.id}
              type="button"
              role="menuitem"
              className="flex w-full gap-3 px-3 py-2.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-ink-700/60"
              onClick={() => {
                clearBadge();
                setOpen(false);
                navigate(`/conversations/${row.id}`);
              }}
            >
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                {row.profilePictureUrl ? (
                  <img src={row.profilePictureUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    {row.contactName.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900 dark:text-ink-50">
                  {row.contactName}
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-ink-600 dark:text-ink-300">{row.preview}</span>
              </span>
            </button>
          ))
        )}
      </div>
      <div className="shrink-0 border-t border-ink-100 p-2 dark:border-ink-600">
        <button
          type="button"
          className="w-full rounded-lg py-1.5 text-center text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40"
          onClick={() => {
            clearBadge();
            setOpen(false);
            navigate("/conversations");
          }}
        >
          {t("conversationAlerts.viewAll")}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="relative shrink-0">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={clsx(
            "relative flex h-11 w-11 items-center justify-center rounded-lg border transition-colors",
            badgeCount > 0
              ? "border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100"
              : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800",
          )}
          title={t("nav.alerts")}
          aria-expanded={open}
          aria-haspopup="true"
        >
          <Bell className={clsx("h-5 w-5", badgeCount > 0 && "animate-pulse")} />
          {badgeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </button>
      </div>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
