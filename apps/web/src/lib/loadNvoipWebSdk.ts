import "nvoip-web-sdk/dist/nvoip-auth-widget.css";

let loadPromise: Promise<void> | null = null;

/** Loads the official Nvoip auth widget (IIFE on window.NvoipAuthWidget). */
export function loadNvoipWebSdk(): Promise<void> {
  if (typeof window !== "undefined" && window.NvoipAuthWidget) {
    return Promise.resolve();
  }
  if (!loadPromise) {
    loadPromise = import("nvoip-web-sdk/dist/nvoip-auth-widget.js").then(() => {
      if (!window.NvoipAuthWidget) {
        throw new Error("nvoip_web_sdk_failed_to_load");
      }
    });
  }
  return loadPromise;
}

export function maskNvoipPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return phone;
  return `****${digits.slice(-4)}`;
}
