import { prisma } from "../db.js";

/** Chaves conhecidas; valores em falta na BD usam `defaultEnabled`. */
export const FEATURE_FLAG_DEFINITIONS = [
  {
    key: "crm_kanban",
    defaultEnabled: true,
  },
  {
    key: "message_templates",
    defaultEnabled: true,
  },
  {
    key: "auto_tag_rules",
    defaultEnabled: true,
  },
  {
    key: "reminders",
    defaultEnabled: true,
  },
  {
    key: "conversation_alerts",
    defaultEnabled: true,
  },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_DEFINITIONS)[number]["key"];

export async function isOrganizationFeatureEnabled(
  organizationId: string,
  key: FeatureFlagKey,
): Promise<boolean> {
  const def = FEATURE_FLAG_DEFINITIONS.find((d) => d.key === key);
  const fallback = def?.defaultEnabled ?? false;

  const row = await prisma.organizationFeatureFlag.findUnique({
    where: { organizationId_key: { organizationId, key } },
    select: { enabled: true },
  });
  if (!row) return fallback;
  return row.enabled;
}
