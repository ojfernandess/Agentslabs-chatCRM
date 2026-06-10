import { prisma } from "../db.js";
import { normalizeDialPhone } from "./nvoipCallContext.js";
import { nvoipCheck2fa, nvoipSend2fa, type NvoipOtpChannel } from "./nvoipClient.js";
import { resolveOrgOtpProvider } from "./otp/resolveOtpProvider.js";
import type { OtpPurpose } from "./otp/types.js";

const OTP_TTL_MS = 10 * 60 * 1000;

export type NvoipWebSdkChannel = "sms" | "voice" | "whatsapp";
export type NvoipWebSdkFlow = "otp" | "2fa";

export function normalizeWebSdkChannel(raw: string | undefined): NvoipWebSdkChannel | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (value === "call" || value === "phone") return "voice";
  if (value === "sms" || value === "voice" || value === "whatsapp") return value;
  return null;
}

export function normalizeWebSdkFlow(raw: string | undefined): NvoipWebSdkFlow {
  return String(raw ?? "otp").toLowerCase() === "2fa" ? "2fa" : "otp";
}

function otpChannelFromWebSdk(channel: NvoipWebSdkChannel): NvoipOtpChannel {
  if (channel === "voice") return "voice";
  return "sms";
}

export async function resolveNvoipWebSdkChannels(organizationId: string): Promise<NvoipWebSdkChannel[]> {
  const account = await prisma.nvoipAccount.findUnique({
    where: { organizationId },
    select: { otpProvider: true, status: true, waInstance: true },
  });
  if (!account || account.status !== "CONNECTED" || account.otpProvider !== "NVOIP") {
    return [];
  }

  const channels: NvoipWebSdkChannel[] = ["sms", "voice"];
  if (account.waInstance?.trim()) {
    channels.push("whatsapp");
  }
  return channels;
}

function startMessage(channel: NvoipWebSdkChannel): string {
  if (channel === "voice") {
    return "Ligação solicitada. Pode levar alguns segundos para tocar com o código.";
  }
  if (channel === "whatsapp") {
    return "Código enviado por WhatsApp.";
  }
  return "SMS enviado com o código.";
}

export async function startNvoipWebSdkVerification(input: {
  organizationId: string;
  phone: string;
  channel: NvoipWebSdkChannel;
  flow: NvoipWebSdkFlow;
  purpose?: OtpPurpose;
  contactId?: string | null;
  userId?: string | null;
  actorUserId?: string;
}): Promise<{ sessionId: string; message: string }> {
  const phone = normalizeDialPhone(input.phone) ?? input.phone.replace(/\D/g, "");
  if (!phone || phone.length < 10) throw new Error("invalid_phone");

  const allowed = await resolveNvoipWebSdkChannels(input.organizationId);
  if (!allowed.includes(input.channel)) {
    throw new Error(`channel_not_enabled:${input.channel}`);
  }

  const account = await prisma.nvoipAccount.findUnique({ where: { organizationId: input.organizationId } });
  if (!account || account.status !== "CONNECTED") throw new Error("nvoip_not_configured");

  const purpose = input.purpose ?? "contact_phone_verify";
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  if (input.flow === "2fa" && input.channel === "sms") {
    const api = await nvoipSend2fa(account);
    const challenge = await prisma.nvoipOtpChallenge.create({
      data: {
        organizationId: input.organizationId,
        nvoipAccountId: account.id,
        purpose: "user_2fa",
        channel: "sms",
        destination: phone,
        nvoipKey: api.token2fa,
        expiresAt,
        contactId: input.contactId ?? null,
        userId: input.userId ?? null,
        status: "PENDING",
      },
    });
    return { sessionId: challenge.id, message: "Código 2FA enviado por SMS." };
  }

  if (input.channel === "whatsapp") {
    throw new Error("whatsapp_otp_use_settings_template");
  }

  const provider = await resolveOrgOtpProvider(input.organizationId);
  if (!provider) throw new Error("otp_provider_not_configured");

  const sent = await provider.send({
    organizationId: input.organizationId,
    destination: phone,
    channel: otpChannelFromWebSdk(input.channel),
    purpose,
    contactId: input.contactId ?? undefined,
    userId: input.userId ?? undefined,
    actorUserId: input.actorUserId,
  });

  return {
    sessionId: sent.challengeId,
    message: startMessage(input.channel),
  };
}

export async function confirmNvoipWebSdkVerification(input: {
  organizationId: string;
  sessionId: string;
  code: string;
  channel: NvoipWebSdkChannel;
  flow: NvoipWebSdkFlow;
}): Promise<{ ok: boolean; status?: string }> {
  const challenge = await prisma.nvoipOtpChallenge.findFirst({
    where: { id: input.sessionId.trim(), organizationId: input.organizationId },
    include: { nvoipAccount: true },
  });
  if (!challenge) throw new Error("otp_challenge_not_found");
  if (challenge.status === "VERIFIED") return { ok: true, status: "verified" };
  if (challenge.status !== "PENDING") throw new Error("otp_challenge_invalid");
  if (challenge.expiresAt.getTime() < Date.now()) {
    await prisma.nvoipOtpChallenge.update({
      where: { id: challenge.id },
      data: { status: "EXPIRED" },
    });
    throw new Error("otp_expired");
  }

  if (input.flow === "2fa" && challenge.purpose === "user_2fa") {
    const result = await nvoipCheck2fa(challenge.nvoipAccount, {
      token2fa: challenge.nvoipKey,
      pin: input.code.trim(),
    });
    if (!result.ok) return { ok: false, status: "invalid" };
    await prisma.nvoipOtpChallenge.update({
      where: { id: challenge.id },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });
    return { ok: true, status: "verified" };
  }

  const provider = await resolveOrgOtpProvider(input.organizationId);
  if (!provider) throw new Error("otp_provider_not_configured");

  const result = await provider.verify({
    organizationId: input.organizationId,
    challengeId: challenge.id,
    code: input.code.trim(),
  });
  if (!result.ok) return { ok: false, status: "invalid" };
  return { ok: true, status: "verified" };
}
