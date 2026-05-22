export type CampaignKind = "followup" | "broadcast" | "ai" | "flow";

const KIND_LABEL_KEYS: Record<CampaignKind, string> = {
  followup: "broadcastPage.kindFollowUp",
  broadcast: "broadcastPage.kindBroadcast",
  ai: "broadcastPage.kindAi",
  flow: "broadcastPage.kindFlow",
};

const KIND_STYLES: Record<CampaignKind, string> = {
  followup: "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
  broadcast: "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  ai: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-200",
  flow: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200",
};

export function isCampaignKind(value: unknown): value is CampaignKind {
  return value === "followup" || value === "broadcast" || value === "ai" || value === "flow";
}

export function campaignKindLabelKey(kind: CampaignKind): string {
  return KIND_LABEL_KEYS[kind];
}

export function campaignKindBadgeClass(kind: CampaignKind): string {
  return KIND_STYLES[kind];
}

export function resolveCampaignKind(row: {
  segmentRules?: unknown;
  flowDefinition?: unknown;
}): CampaignKind {
  const rules =
    row.segmentRules && typeof row.segmentRules === "object"
      ? (row.segmentRules as Record<string, unknown>)
      : null;
  const raw = rules?.campaignKind;
  if (isCampaignKind(raw)) return raw;
  if (rules?.followUpRecurrence) return "followup";
  if (row.flowDefinition) return "flow";
  return "broadcast";
}

export function segmentRulesWithKind(
  rules: Record<string, unknown>,
  kind: CampaignKind,
): Record<string, unknown> {
  return { ...rules, campaignKind: kind };
}
