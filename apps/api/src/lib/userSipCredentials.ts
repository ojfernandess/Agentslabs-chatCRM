import { prisma } from "../db.js";
import { config } from "../config.js";
import { encrypt, decrypt } from "./encryption.js";

export type UserSipCredentialsClient = {
  sipUser: string;
  sipPassword: string;
  displayName: string | null;
  sipServer: string;
  wssPort: string;
};

export function nvoipSipWssUrl(): string {
  return `wss://${config.nvoipSipServer}:${config.nvoipSipWssPort}`;
}

export async function getUserSipCredentialsForClient(
  userId: string,
): Promise<UserSipCredentialsClient | null> {
  const row = await prisma.userSipCredentials.findUnique({
    where: { userId },
    select: { sipUser: true, sipPasswordEnc: true, displayName: true },
  });
  if (!row) return null;
  const sipPassword = decrypt(row.sipPasswordEnc);
  if (!sipPassword?.trim()) return null;
  return {
    sipUser: row.sipUser.trim(),
    sipPassword,
    displayName: row.displayName?.trim() || null,
    sipServer: config.nvoipSipServer,
    wssPort: config.nvoipSipWssPort,
  };
}

export async function upsertUserSipCredentials(input: {
  userId: string;
  sipUser: string;
  sipPassword: string;
  displayName?: string | null;
}): Promise<void> {
  const sipUser = input.sipUser.trim();
  const sipPassword = input.sipPassword.trim();
  if (!sipUser || !sipPassword) {
    throw new Error("sip_credentials_invalid");
  }
  await prisma.userSipCredentials.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      sipUser,
      sipPasswordEnc: encrypt(sipPassword),
      displayName: input.displayName?.trim() || null,
    },
    update: {
      sipUser,
      sipPasswordEnc: encrypt(sipPassword),
      displayName: input.displayName?.trim() || null,
    },
  });
}
