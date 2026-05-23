export type LeadValueRollupKind = "PIPELINE" | "WON" | "LOST" | "NONE" | string;

export type ClosureRollupRow = {
  conversationId: string;
  sessionIndex: number;
  closureValue: number | null;
  leadType: { valueRollup?: LeadValueRollupKind | null } | null;
};

export function closureRecordContribution(
  row: ClosureRollupRow,
): "WON" | "PIPELINE" | "IGNORE" {
  const v = row.closureValue ?? 0;
  if (v <= 0) return "IGNORE";
  const roll = row.leadType?.valueRollup ?? "PIPELINE";
  if (roll === "WON") return "WON";
  if (roll === "PIPELINE") return "PIPELINE";
  return "IGNORE";
}

export function latestClosureRecordPerConversationAndBucket<T extends ClosureRollupRow>(
  records: T[],
  bucket: "WON" | "PIPELINE",
): T[] {
  const map = new Map<string, T>();
  for (const row of records) {
    if (closureRecordContribution(row) !== bucket) continue;
    const prev = map.get(row.conversationId);
    if (!prev || row.sessionIndex > prev.sessionIndex) {
      map.set(row.conversationId, row);
    }
  }
  return [...map.values()];
}

export function latestClosureRecordPerConversation<T extends ClosureRollupRow>(
  records: T[],
): T[] {
  const map = new Map<string, T>();
  for (const row of records) {
    const prev = map.get(row.conversationId);
    if (!prev || row.sessionIndex > prev.sessionIndex) {
      map.set(row.conversationId, row);
    }
  }
  return [...map.values()];
}

export function computeClosureRollupTotals(records: ClosureRollupRow[]): {
  wonValue: number;
  pipelineValue: number;
} {
  const latestWon = latestClosureRecordPerConversationAndBucket(records, "WON");
  const latestPipeline = latestClosureRecordPerConversationAndBucket(records, "PIPELINE");

  let wonValue = 0;
  let pipelineValue = 0;
  for (const row of latestWon) {
    wonValue += row.closureValue ?? 0;
  }
  for (const row of latestPipeline) {
    pipelineValue += row.closureValue ?? 0;
  }
  return { wonValue, pipelineValue };
}

export function pickLatestClosureRecord<T extends { sessionIndex: number }>(
  records: T[] | undefined | null,
): T | null {
  if (!records?.length) return null;
  return records.reduce((best, row) => (row.sessionIndex > best.sessionIndex ? row : best));
}

export function shouldCarryForwardClosureValue(
  lastLeadValueRollup: LeadValueRollupKind | null | undefined,
): boolean {
  return lastLeadValueRollup !== "WON";
}
