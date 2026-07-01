import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { decryptNvoipSecret, encryptNvoipSecret } from "./nvoipConfig.js";
import { mergeNvoipExternalConfig } from "./nvoipExternalConfig.js";

function asRecord(raw: unknown): Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function generateNvoipCallWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

export function readNvoipCallWebhookSecret(externalConfig: unknown): string | null {
  const enc = asRecord(externalConfig).callWebhookSecretEnc;
  if (typeof enc !== "string" || !enc.trim()) return null;
  return decryptNvoipSecret(enc);
}

export function verifyNvoipCallWebhookSecret(
  externalConfig: unknown,
  provided: string | undefined,
): boolean {
  const expected = readNvoipCallWebhookSecret(externalConfig);
  if (!expected) return false;
  const token = provided?.trim();
  if (!token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildNvoipCallWebhookUrl(organizationId: string, secret: string): string | null {
  const publicUrl = config.publicUrl?.replace(/\/+$/, "") ?? "";
  if (!publicUrl) return null;
  return `${publicUrl}/webhooks/nvoip/${organizationId}?token=${encodeURIComponent(secret)}`;
}

export async function ensureNvoipCallWebhookSecretForAccount(input: {
  accountId: string;
  externalConfig: unknown;
}): Promise<{ secret: string; externalConfig: Prisma.InputJsonValue }> {
  const existing = readNvoipCallWebhookSecret(input.externalConfig);
  if (existing) {
    return { secret: existing, externalConfig: input.externalConfig as Prisma.InputJsonValue };
  }

  const secret = generateNvoipCallWebhookSecret();
  const merged = mergeNvoipExternalConfig(input.externalConfig, {
    callWebhookSecretEnc: encryptNvoipSecret(secret),
  });
  await prisma.nvoipAccount.update({
    where: { id: input.accountId },
    data: { externalConfig: merged },
  });
  return { secret, externalConfig: merged };
}
