/** Classificação do valor do tipo de lead (espelha LeadValueRollup no Prisma). */
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

/** Último atendimento por conversa — evita somar PIPELINE antigo após novo encerramento WON. */
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
  const latest = latestClosureRecordPerConversation(records);
  let wonValue = 0;
  let pipelineValue = 0;
  for (const row of latest) {
    const bucket = closureRecordContribution(row);
    const v = row.closureValue ?? 0;
    if (bucket === "WON") wonValue += v;
    else if (bucket === "PIPELINE") pipelineValue += v;
  }
  return { wonValue, pipelineValue };
}

/** Último registo de encerramento da conversa (maior sessionIndex). */
export function pickLatestClosureRecord<T extends { sessionIndex: number }>(
  records: T[] | undefined | null,
): T | null {
  if (!records?.length) return null;
  return records.reduce((best, row) => (row.sessionIndex > best.sessionIndex ? row : best));
}

/** Após venda (WON), novo atendimento começa sem valor herdado. */
export function shouldCarryForwardClosureValue(
  lastLeadValueRollup: LeadValueRollupKind | null | undefined,
): boolean {
  return lastLeadValueRollup !== "WON";
}
