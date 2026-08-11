import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ConversationAlertPreview } from "@/hooks/useConversationAlerts";
import { ContactAvatar } from "@/components/ContactAvatar";
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

type PanelPos = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
};

/**
 * CSS `zoom` no html (notebooks) faz getBoundingClientRect (coords visuais)
 * divergir de `position: fixed` (coords de layout). Dividimos pelo zoom.
 * No fallback com `transform: scale` no #root, o portal fica no body (fora do
 * scale) e as coords já batem — o zoom computado do html é "normal"/1.
 */
function getCssZoomFactor(): number {
  if (typeof document === "undefined") return 1;
  const root = document.documentElement;
  if (!root.classList.contains("desktop-viewport-scaled")) return 1;
  const zoomRaw = getComputedStyle(root).zoom;
  const zoom = Number(zoomRaw);
  if (Number.isFinite(zoom) && zoom > 0 && Math.abs(zoom - 1) > 0.001) {
    return zoom;
  }
  return 1;
}

/**
 * Ancora o painel ao sino.
 * Em monitores pequenos o sino fica no fundo: abrimos para cima com `bottom`
 * (sem translateY/% da altura máxima, que afastava o painel do ícone).
 */
function computePanelPosition(anchor: DOMRect): PanelPos {
  const scale = getCssZoomFactor();
  const top = anchor.top / scale;
  const bottom = anchor.bottom / scale;
  const right = anchor.right / scale;
  const vw = window.innerWidth / scale;
  const vh = window.innerHeight / scale;
  const gap = GAP / scale;
  const margin = MARGIN / scale;
  const panelMax = PANEL_MAX / scale;
  const minUseful = MIN_USEFUL_SPACE / scale;

  const width = Math.min(PANEL_W / scale, vw - margin * 2);
  let left = right - width;
  left = Math.max(margin, Math.min(left, vw - width - margin));

  const spaceBelow = vh - bottom - gap - margin;
  const spaceAbove = top - gap - margin;

  if (spaceBelow >= minUseful && spaceBelow >= spaceAbove) {
    return {
      top: bottom + gap,
      left,
      width,
      maxHeight: Math.min(panelMax, spaceBelow),
      placement: "below",
    };
  }

  // Preferir acima (caso típico do sino na sidebar inferior)
  if (spaceAbove >= spaceBelow || spaceAbove >= minUseful) {
    // bottom CSS = distância da base do viewport até a base do painel
    // Base do painel = topo do ícone − gap  →  vh - (top - gap)
    return {
      bottom: Math.max(margin, vh - top + gap),
      left,
      width,
      maxHeight: Math.max(72 / scale, Math.min(panelMax, spaceAbove)),
      placement: "above",
    };
  }

  return {
    top: bottom + gap,
    left,
    width,
    maxHeight: Math.max(72 / scale, Math.min(panelMax, spaceBelow)),
    placement: "below",
  };
}

export function ConversationNotifyBell({ badgeCount, alertPreviews, clearBadge }: ConversationNotifyBellProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<PanelPos>({
    top: 0,
    left: 0,
    width: PANEL_W,
    maxHeight: PANEL_MAX,
    placement: "below",
  });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    setPos(computePanelPosition(anchor.getBoundingClientRect()));
  }, [open, alertPreviews.length]);

  useEffect(() => {
    if (!open) return;
    const on = () => {
      const el = anchorRef.current;
      if (!el) return;
      setPos(computePanelPosition(el.getBoundingClientRect()));
    };
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    window.visualViewport?.addEventListener("resize", on);
    window.visualViewport?.addEventListener("scroll", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      window.visualViewport?.removeEventListener("resize", on);
      window.visualViewport?.removeEventListener("scroll", on);
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
      style={{
        top: pos.placement === "below" ? pos.top : "auto",
        bottom: pos.placement === "above" ? pos.bottom : "auto",
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
      }}
      className={clsx(
        "fixed z-[1000] flex flex-col overflow-hidden rounded-xl border shadow-xl",
        "border-ink-200 bg-white dark:border-slate-500/25 dark:bg-[#24344d]/85",
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
              <ContactAvatar
                contactId={row.contactId}
                name={row.contactName}
                profilePictureUrl={row.profilePictureUrl}
                className="h-10 w-10 text-sm"
              />
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
      <div className="shrink-0 border-t border-ink-100 p-2 dark:border-slate-500/25">
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
              : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-slate-500/25 dark:bg-white/5 dark:text-ink-200 dark:hover:bg-white/10",
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
