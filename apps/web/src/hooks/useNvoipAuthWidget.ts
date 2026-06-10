import { useCallback } from "react";
import { api, ApiError } from "@/lib/api";
import { loadNvoipWebSdk, maskNvoipPhone } from "@/lib/loadNvoipWebSdk";
import type {
  NvoipAuthWidgetOptions,
  NvoipWebSdkChannel,
  NvoipWebSdkFlow,
} from "@/types/nvoip-web-sdk";

type OpenWidgetInput = {
  flow?: NvoipWebSdkFlow;
  phone: string;
  contactId?: string;
  purpose?: "contact_phone_verify" | "user_2fa" | "admin_test";
  allowPhoneEdit?: boolean;
  accountLabel?: string;
  onSuccess?: NvoipAuthWidgetOptions["onSuccess"];
};

export function useNvoipAuthWidget() {
  const startVerification = useCallback(
    async (payload: {
      phone: string;
      channel?: string;
      flow?: NvoipWebSdkFlow;
      contactId?: string;
      purpose?: string;
    }) => {
      try {
        const res = await api.post<{ sessionId: string; message?: string }>("/nvoip/web-sdk/auth/start", {
          phone: payload.phone,
          channel: payload.channel,
          flow: payload.flow,
          contactId: payload.contactId,
          purpose: payload.purpose,
        });
        return { sessionId: res.sessionId, message: res.message };
      } catch (e) {
        const message = e instanceof ApiError ? e.message : "otp_send_failed";
        throw new Error(message);
      }
    },
    [],
  );

  const confirmVerification = useCallback(
    async (payload: {
      sessionId: string;
      code: string;
      channel?: string;
      flow?: NvoipWebSdkFlow;
    }) => {
      try {
        return await api.post<{ ok: boolean }>("/nvoip/web-sdk/auth/confirm", {
          sessionId: payload.sessionId,
          code: payload.code,
          channel: payload.channel,
          flow: payload.flow,
        });
      } catch (e) {
        const message = e instanceof ApiError ? e.message : "otp_verify_failed";
        throw new Error(message);
      }
    },
    [],
  );

  const openWidget = useCallback(
    async (input: OpenWidgetInput) => {
      await loadNvoipWebSdk();
      const config = await api.get<{ channels: NvoipWebSdkChannel[]; flow: NvoipWebSdkFlow }>(
        "/nvoip/web-sdk/config",
      );
      const widget = window.NvoipAuthWidget;
      if (!widget) throw new Error("nvoip_web_sdk_failed_to_load");

      const base: NvoipAuthWidgetOptions = {
        channels: config.channels.length ? config.channels : ["sms", "voice"],
        phone: input.phone,
        maskedPhone: maskNvoipPhone(input.phone),
        allowPhoneEdit: input.allowPhoneEdit ?? false,
        accountLabel: input.accountLabel,
        closeOnSuccess: true,
        redirectOnSuccess: false,
        startVerification: (payload) =>
          startVerification({
            ...payload,
            contactId: input.contactId,
            purpose: input.purpose,
          }),
        confirmVerification,
        onSuccess: input.onSuccess,
      };

      if (input.flow === "2fa") {
        widget.start2FA({ ...base, flow: "2fa" });
      } else {
        widget.startOTP({ ...base, flow: "otp" });
      }
    },
    [confirmVerification, startVerification],
  );

  return { openWidget, startVerification, confirmVerification };
}
