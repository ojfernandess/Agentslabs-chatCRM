import { useEffect } from "react";

const CSS_VH = "--crm-mobile-vvh";
const CSS_OFFSET = "--crm-mobile-vvo";

/**
 * Keeps the conversation thread within the visible viewport when the mobile keyboard opens
 * (iOS/Android shrink visualViewport). Desktop is unaffected.
 */
export function useMobileConversationViewport(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    if (!mq.matches) return;

    const root = document.documentElement;

    const apply = () => {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.removeProperty(CSS_VH);
        root.style.removeProperty(CSS_OFFSET);
        return;
      }
      root.style.setProperty(CSS_VH, `${Math.round(vv.height)}px`);
      root.style.setProperty(CSS_OFFSET, `${Math.round(vv.offsetTop)}px`);
    };

    apply();
    vvSubscribe(apply);
    window.addEventListener("orientationchange", apply);

    return () => {
      root.style.removeProperty(CSS_VH);
      root.style.removeProperty(CSS_OFFSET);
      vvUnsubscribe(apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, [enabled]);
}

function vvSubscribe(apply: () => void): void {
  window.visualViewport?.addEventListener("resize", apply, { passive: true });
  window.visualViewport?.addEventListener("scroll", apply, { passive: true });
}

function vvUnsubscribe(apply: () => void): void {
  window.visualViewport?.removeEventListener("resize", apply);
  window.visualViewport?.removeEventListener("scroll", apply);
}
