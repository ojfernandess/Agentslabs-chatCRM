import { prisma } from "../db.js";

/** Chaves conhecidas; valores em falta na BD usam `defaultEnabled`. */
export const FEATURE_FLAG_DEFINITIONS = [
  {
    key: "crm_kanban",
    defaultEnabled: true,
  },
  {
    key: "crm_deals",
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
  {
    key: "whatsapp_groups",
    defaultEnabled: false,
  },
  {
    key: "broadcast_campaigns",
    defaultEnabled: true,
  },
  {
    key: "chatbot_flow_builder",
    defaultEnabled: true,
  },
  {
    key: "teams_collaboration_hub",
    defaultEnabled: false,
  },
  {
    key: "teams_channels",
    defaultEnabled: false,
  },
  {
    key: "teams_workspace",
    defaultEnabled: false,
  },
  {
    key: "teams_ai_copilot",
    defaultEnabled: false,
  },
  {
    key: "teams_realtime_ops",
    defaultEnabled: false,
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

/** Mapa de todas as flags conhecidas para o tenant (valores efectivos após fallback). */
export async function getOrganizationFeatureMap(
  organizationId: string,
): Promise<Record<FeatureFlagKey, boolean>> {
  const entries = await Promise.all(
    FEATURE_FLAG_DEFINITIONS.map(
      async (d) => [d.key, await isOrganizationFeatureEnabled(organizationId, d.key)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<FeatureFlagKey, boolean>;
}
