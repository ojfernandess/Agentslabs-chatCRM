/**
 * Escala proporcional automática da interface desktop em viewports menores.
 * Activa apenas em `(min-width: 1024px) and (pointer: fine)` — não afecta mobile/tablet touch.
 */
const DESKTOP_MEDIA = "(min-width: 1024px) and (pointer: fine)";

/** Largura de referência onde a UI ocupa o espaço previsto pelo design (scale = 1). */
const REFERENCE_WIDTH = 1680;
/** Altura de referência (ex.: 900px+) — notebooks 768px de altura também entram no cálculo. */
const REFERENCE_HEIGHT = 900;
const MIN_SCALE = 0.8;
const MAX_SCALE = 1;
const SCALE_EPSILON = 0.004;

let rafId = 0;
let desktopMq: MediaQueryList | null = null;

export function computeDesktopViewportScale(
  width = window.innerWidth,
  height = window.innerHeight,
): number {
  const widthScale = width / REFERENCE_WIDTH;
  const heightScale = height / REFERENCE_HEIGHT;
  const raw = Math.min(widthScale, heightScale);
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
}

function applyDesktopViewportScale(): void {
  const root = document.documentElement;
  const isDesktop = window.matchMedia(DESKTOP_MEDIA).matches;

  if (!isDesktop) {
    root.classList.remove("desktop-viewport-scaled");
    root.style.removeProperty("--desktop-ui-scale");
    return;
  }

  const scale = computeDesktopViewportScale();
  if (scale >= MAX_SCALE - SCALE_EPSILON) {
    root.classList.remove("desktop-viewport-scaled");
    root.style.removeProperty("--desktop-ui-scale");
    return;
  }

  root.style.setProperty("--desktop-ui-scale", scale.toFixed(4));
  root.classList.add("desktop-viewport-scaled");
}

function scheduleApply(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(applyDesktopViewportScale);
}

/** Inicializa detecção de viewport e reaplica escala em resize / mudança de breakpoint desktop. */
export function initDesktopViewportScale(): void {
  applyDesktopViewportScale();

  window.addEventListener("resize", scheduleApply, { passive: true });
  window.visualViewport?.addEventListener("resize", scheduleApply, { passive: true });

  desktopMq = window.matchMedia(DESKTOP_MEDIA);
  desktopMq.addEventListener("change", scheduleApply);
}
