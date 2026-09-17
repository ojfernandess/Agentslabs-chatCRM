import { prisma } from "../../db.js";
import { normalizeAiBillingMode, type AiBillingMode } from "./aiBillingTypes.js";

export async function getOrganizationAiBillingMode(organizationId: string): Promise<AiBillingMode> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { aiBillingMode: true },
  });
  return normalizeAiBillingMode(org?.aiBillingMode);
}
