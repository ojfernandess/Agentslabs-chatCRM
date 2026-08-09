/**
 * Densidade visual em desktop compacto (notebooks).
 * Define --desktop-ui-scale (~0.8 em 1366×768); o CSS aplica zoom/transform
 * com width/height = 100% / scale para preencher a viewport sem faixa vazia.
 * Não afecta mobile/tablet touch: só `(min-width: 1024px) and (pointer: fine)`.
 */
const DESKTOP_MEDIA = "(min-width: 1024px) and (pointer: fine)";

/** Viewport de referência do design (scale = 1). */
const REFERENCE_WIDTH = 1680;
const REFERENCE_HEIGHT = 900;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1;
const SCALE_EPSILON = 0.004;

let rafId = 0;
let desktopMq: MediaQueryList | null = null;

export function computeDesktopViewportScale(
  width = typeof window !== "undefined" ? window.innerWidth : REFERENCE_WIDTH,
  height = typeof window !== "undefined" ? window.innerHeight : REFERENCE_HEIGHT,
): number {
  const widthScale = width / REFERENCE_WIDTH;
  const heightScale = height / REFERENCE_HEIGHT;
  const raw = Math.min(widthScale, heightScale);
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
}

function clearDesktopViewportScale(): void {
  const root = document.documentElement;
  root.classList.remove("desktop-viewport-scaled");
  root.style.removeProperty("--desktop-ui-scale");
}

function applyDesktopViewportScale(): void {
  const root = document.documentElement;
  const isDesktop = window.matchMedia(DESKTOP_MEDIA).matches;

  if (!isDesktop) {
    clearDesktopViewportScale();
    return;
  }

  const scale = computeDesktopViewportScale();
  if (scale >= MAX_SCALE - SCALE_EPSILON) {
    clearDesktopViewportScale();
    return;
  }

  root.style.setProperty("--desktop-ui-scale", scale.toFixed(4));
  root.classList.add("desktop-viewport-scaled");
}

function scheduleApply(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(applyDesktopViewportScale);
}

/** Inicializa escala compensada e reaplica em resize / mudança de breakpoint. */
export function initDesktopViewportScale(): void {
  applyDesktopViewportScale();

  window.addEventListener("resize", scheduleApply, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleApply, { passive: true });

  desktopMq = window.matchMedia(DESKTOP_MEDIA);
  desktopMq.addEventListener("change", scheduleApply);
}
