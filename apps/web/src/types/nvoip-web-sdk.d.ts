export type NvoipWebSdkChannel = "sms" | "voice" | "whatsapp";
export type NvoipWebSdkFlow = "otp" | "2fa";

export type NvoipAuthWidgetStartPayload = {
  phone: string;
  channel?: string;
  flow?: NvoipWebSdkFlow;
  contactId?: string;
  purpose?: string;
};

export type NvoipAuthWidgetConfirmPayload = {
  sessionId: string;
  code: string;
  phone?: string;
  channel?: string;
  flow?: NvoipWebSdkFlow;
};

export type NvoipAuthWidgetOptions = {
  flow?: NvoipWebSdkFlow;
  channels?: NvoipWebSdkChannel[] | Array<{ id: string; label?: string; description?: string }>;
  phone?: string;
  maskedPhone?: string;
  allowPhoneEdit?: boolean;
  accountLabel?: string;
  closeOnSuccess?: boolean;
  redirectOnSuccess?: boolean;
  returnTo?: string;
  startVerification: (payload: NvoipAuthWidgetStartPayload) => Promise<{ sessionId: string; message?: string }>;
  confirmVerification: (payload: NvoipAuthWidgetConfirmPayload) => Promise<unknown>;
  onSuccess?: (ctx: {
    phone: string;
    code: string;
    sessionId: string;
    channel: string;
    flow: NvoipWebSdkFlow;
    result: unknown;
  }) => void | boolean | Promise<void | boolean>;
};

export type NvoipAuthWidgetApi = {
  open: (options: NvoipAuthWidgetOptions) => unknown;
  startOTP: (options: NvoipAuthWidgetOptions) => unknown;
  start2FA: (options: NvoipAuthWidgetOptions) => unknown;
  mount: (trigger: HTMLElement, options: NvoipAuthWidgetOptions) => void;
};

declare global {
  interface Window {
    NvoipAuthWidget?: NvoipAuthWidgetApi;
  }
}

export {};
