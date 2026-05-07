/**
 * Facebook JS SDK + WhatsApp Embedded Signup (official Meta flow).
 * @see https://developers.facebook.com/docs/whatsapp/embedded-signup/overview
 */

export function loadFacebookSdk(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (document.getElementById("facebook-jssdk")) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const js = document.createElement("script");
    js.id = "facebook-jssdk";
    js.src = "https://connect.facebook.net/en_US/sdk.js";
    js.async = true;
    js.crossOrigin = "anonymous";
    js.onload = () => resolve();
    js.onerror = () => reject(new Error("Failed to load Facebook SDK"));
    document.body.appendChild(js);
  });
}

export function initializeFacebook(appId: string, apiVersion: string): Promise<void> {
  const version = apiVersion?.trim() || "v22.0";
  return new Promise((resolve) => {
    const init = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version,
      });
      resolve();
    };
    if (window.FB) {
      init();
    } else {
      window.fbAsyncInit = init;
    }
  });
}

export async function setupFacebookSdk(appId: string, apiVersion: string): Promise<void> {
  await loadFacebookSdk();
  await initializeFacebook(appId, apiVersion);
}

export function isValidEmbeddedBusinessData(data: unknown): data is {
  business_id: string;
  waba_id: string;
  phone_number_id?: string;
} {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return typeof d.business_id === "string" && typeof d.waba_id === "string";
}

export function createEmbeddedSignupMessageHandler(
  onData: (data: {
    event: string;
    data?: Record<string, unknown>;
    error_message?: string;
    error_id?: string;
    session_id?: string;
  }) => void,
): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    if (!event.origin.endsWith("facebook.com")) return;
    try {
      let data: unknown;
      if (typeof event.data === "string") {
        data = JSON.parse(event.data) as unknown;
      } else if (typeof event.data === "object" && event.data !== null) {
        data = event.data;
      } else {
        return;
      }
      const payload = data as { type?: string };
      if (payload.type === "WA_EMBEDDED_SIGNUP") {
        onData(data as Parameters<typeof onData>[0]);
      }
    } catch {
      /* ignore */
    }
  };
}

export function initWhatsAppEmbeddedSignup(configId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error("Facebook SDK not loaded"));
      return;
    }
    window.FB.login(
      (response: { authResponse?: { code?: string }; error?: { message?: string } }) => {
        if (response.authResponse?.code) {
          resolve(response.authResponse.code);
        } else if (response.error) {
          reject(new Error(response.error.message ?? "Facebook login error"));
        } else {
          reject(new Error("Login cancelled"));
        }
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  });
}

declare global {
  interface Window {
    FB?: {
      init: (opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
      login: (
        cb: (r: { authResponse?: { code?: string }; error?: { message?: string } }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}
