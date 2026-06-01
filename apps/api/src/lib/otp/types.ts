import type { NvoipOtpChannel } from "../nvoipClient.js";

export type OtpPurpose = "contact_phone_verify" | "user_2fa" | "admin_test";

export type OtpSendInput = {
  organizationId: string;
  destination: string;
  channel: NvoipOtpChannel;
  purpose: OtpPurpose;
  contactId?: string;
  userId?: string;
  actorUserId?: string;
};

export type OtpSendResult = {
  challengeId: string;
  key: string;
  expiresAt: string;
  provider: string;
};

export type OtpVerifyInput = {
  organizationId: string;
  challengeId: string;
  code: string;
};

export type OtpVerifyResult = {
  ok: boolean;
  provider: string;
};

export interface OtpProvider {
  readonly id: string;
  send(input: OtpSendInput): Promise<OtpSendResult>;
  verify(input: OtpVerifyInput): Promise<OtpVerifyResult>;
}
