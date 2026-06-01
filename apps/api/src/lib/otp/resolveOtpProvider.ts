import { prisma } from "../../db.js";
import { isOrganizationFeatureEnabled } from "../featureFlags.js";
import { NvoipOtpProvider } from "./nvoipOtpProvider.js";
import type { OtpProvider } from "./types.js";

export async function resolveOrgOtpProvider(organizationId: string): Promise<OtpProvider | null> {
  const otpEnabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_otp");
  if (!otpEnabled) return null;

  const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
  if (!account || account.status !== "CONNECTED" || account.otpProvider !== "NVOIP") {
    return null;
  }

  return new NvoipOtpProvider(account);
}
