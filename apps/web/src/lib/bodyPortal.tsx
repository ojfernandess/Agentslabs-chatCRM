import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/** Render overlays in document.body to escape #root zoom/transform clipping. */
export function bodyPortal(node: ReactNode) {
  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
