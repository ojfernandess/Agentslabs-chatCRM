import type { NvoipAccount, NvoipAccountStatus } from "@prisma/client";
import { encrypt, decrypt } from "./encryption.js";

export const MASKED_NVOIP_SECRET = "••••••••";

export type NvoipAccountClientRow = {
  id: string;
  numbersip: string;
  defaultCaller: string;
  status: NvoipAccountStatus;
  inboxId: string | null;
  inboxName: string | null;
  lastBalance: string | null;
  lastStatusAt: string | null;
  lastError: string | null;
  otpProvider: string;
  otpDefaultChannel: string;
  waInstance: string | null;
  waDefaultLanguage: string;
  hasUserToken: boolean;
  hasNapikey: boolean;
  createdAt: string;
  updatedAt: string;
};

export function encryptNvoipSecret(value: string): string {
  return encrypt(value.trim());
}

export function decryptNvoipSecret(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  return decrypt(stored);
}

export function accountToClientRow(
  row: NvoipAccount & { inbox?: { name: string } | null },
): NvoipAccountClientRow {
  return {
    id: row.id,
    numbersip: row.numbersip,
    defaultCaller: row.defaultCaller,
    status: row.status,
    inboxId: row.inboxId,
    inboxName: row.inbox?.name ?? null,
    lastBalance: row.lastBalance,
    lastStatusAt: row.lastStatusAt?.toISOString() ?? null,
    lastError: row.lastError,
    otpProvider: row.otpProvider,
    otpDefaultChannel: row.otpDefaultChannel,
    waInstance: row.waInstance,
    waDefaultLanguage: row.waDefaultLanguage,
    hasUserToken: Boolean(row.userTokenEnc),
    hasNapikey: Boolean(row.napikeyEnc),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
