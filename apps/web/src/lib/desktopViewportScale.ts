/**
 * Historicamente aplicava zoom/scale artificial em desktop compacto.
 * Removido: a UI deve ser responsiva por flex/grid (100% da viewport), sem zoom CSS.
 * Mantido como no-op que limpa classes residuais de sessões anteriores.
 */
export function initDesktopViewportScale(): void {
  const root = document.documentElement;
  root.classList.remove("desktop-viewport-scaled");
  root.style.removeProperty("--desktop-ui-scale");
}

/** @deprecated Escala artificial desactivada — sempre 1. */
export function computeDesktopViewportScale(): number {
  return 1;
}
