import type { AiCreditPackage } from "@prisma/client";
import { prisma } from "../../db.js";
import { money, moneyToApiString } from "./money.js";

export function serializeAiCreditPackage(row: AiCreditPackage) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    creditAmount: moneyToApiString(row.creditAmount),
    amountCents: row.amountCents,
    currency: row.currency,
    stripePriceId: row.stripePriceId,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
  };
}

export async function listActiveAiCreditPackages() {
  const rows = await prisma.aiCreditPackage.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(serializeAiCreditPackage);
}

export async function listAllAiCreditPackages() {
  const rows = await prisma.aiCreditPackage.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(serializeAiCreditPackage);
}

export async function getAiCreditPackageById(packageId: string) {
  return prisma.aiCreditPackage.findFirst({
    where: { id: packageId, isActive: true },
  });
}

export async function createAiCreditPackage(input: {
  slug: string;
  name: string;
  description?: string | null;
  creditAmount: string | number;
  amountCents: number;
  currency?: string;
  stripePriceId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}) {
  const row = await prisma.aiCreditPackage.create({
    data: {
      slug: input.slug.trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      creditAmount: money(input.creditAmount),
      amountCents: input.amountCents,
      currency: input.currency?.trim().toUpperCase() || "USD",
      stripePriceId: input.stripePriceId?.trim() || null,
      displayOrder: input.displayOrder ?? 0,
      isActive: input.isActive ?? true,
    },
  });
  return serializeAiCreditPackage(row);
}

export async function updateAiCreditPackage(
  packageId: string,
  patch: Partial<{
    slug: string;
    name: string;
    description: string | null;
    creditAmount: string | number;
    amountCents: number;
    currency: string;
    stripePriceId: string | null;
    displayOrder: number;
    isActive: boolean;
  }>,
) {
  const row = await prisma.aiCreditPackage.update({
    where: { id: packageId },
    data: {
      ...(patch.slug !== undefined ? { slug: patch.slug.trim().toLowerCase() } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.creditAmount !== undefined ? { creditAmount: money(patch.creditAmount) } : {}),
      ...(patch.amountCents !== undefined ? { amountCents: patch.amountCents } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency.trim().toUpperCase() } : {}),
      ...(patch.stripePriceId !== undefined ? { stripePriceId: patch.stripePriceId?.trim() || null } : {}),
      ...(patch.displayOrder !== undefined ? { displayOrder: patch.displayOrder } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
  });
  return serializeAiCreditPackage(row);
}
