import type { NvoipAccount } from "@prisma/client";
import { prisma } from "../../db.js";
import { nvoipCheckOtp, nvoipSendOtp, type NvoipOtpChannel } from "../nvoipClient.js";
import { normalizeDialPhone } from "../nvoipCallContext.js";
import type { OtpProvider, OtpSendInput, OtpSendResult, OtpVerifyInput, OtpVerifyResult } from "./types.js";

const OTP_TTL_MS = 10 * 60 * 1000;

export class NvoipOtpProvider implements OtpProvider {
  readonly id = "nvoip";

  constructor(private readonly account: NvoipAccount) {}

  async send(input: OtpSendInput): Promise<OtpSendResult> {
    const destination =
      input.channel === "email" ? input.destination.trim() : normalizeDialPhone(input.destination);
    if (!destination) throw new Error("invalid_otp_destination");

    const api = await nvoipSendOtp(this.account, {
      destination,
      channel: input.channel,
    });

    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const challenge = await prisma.nvoipOtpChallenge.create({
      data: {
        organizationId: input.organizationId,
        nvoipAccountId: this.account.id,
        purpose: input.purpose,
        channel: input.channel,
        destination,
        nvoipKey: api.key,
        expiresAt,
        contactId: input.contactId ?? null,
        userId: input.userId ?? null,
        status: "PENDING",
      },
    });

    return {
      challengeId: challenge.id,
      key: api.key,
      expiresAt: expiresAt.toISOString(),
      provider: this.id,
    };
  }

  async verify(input: OtpVerifyInput): Promise<OtpVerifyResult> {
    const challenge = await prisma.nvoipOtpChallenge.findFirst({
      where: { id: input.challengeId, organizationId: input.organizationId },
    });
    if (!challenge) throw new Error("otp_challenge_not_found");
    if (challenge.status === "VERIFIED") return { ok: true, provider: this.id };
    if (challenge.status !== "PENDING") throw new Error("otp_challenge_invalid");
    if (challenge.expiresAt.getTime() < Date.now()) {
      await prisma.nvoipOtpChallenge.update({
        where: { id: challenge.id },
        data: { status: "EXPIRED" },
      });
      throw new Error("otp_expired");
    }

    const result = await nvoipCheckOtp(this.account, {
      code: input.code,
      key: challenge.nvoipKey,
    });

    if (!result.ok) return { ok: false, provider: this.id };

    await prisma.nvoipOtpChallenge.update({
      where: { id: challenge.id },
      data: { status: "VERIFIED", verifiedAt: new Date() },
    });

    return { ok: true, provider: this.id };
  }
}

export function parseOtpChannel(raw: string | undefined): NvoipOtpChannel {
  const c = (raw ?? "sms").toLowerCase();
  if (c === "voice" || c === "email") return c;
  return "sms";
}
