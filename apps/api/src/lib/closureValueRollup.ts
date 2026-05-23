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

/** Último encerramento da conversa dentro de um bucket (WON ou PIPELINE). */
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

/** Último atendimento por conversa (qualquer classificação). */
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

/**
 * Vendido: soma de todos os encerramentos WON (cada venda / sessão conta).
 * Negociação: por conversa, só o último encerramento se ainda for pipeline (venda WON posterior zera).
 */
export function computeClosureRollupTotals(records: ClosureRollupRow[]): {
  wonValue: number;
  pipelineValue: number;
} {
  let wonValue = 0;
  for (const row of records) {
    if (closureRecordContribution(row) === "WON") {
      wonValue += row.closureValue ?? 0;
    }
  }

  const latestPerConversation = latestClosureRecordPerConversation(records);
  let pipelineValue = 0;
  for (const row of latestPerConversation) {
    if (closureRecordContribution(row) === "PIPELINE") {
      pipelineValue += row.closureValue ?? 0;
    }
  }

  return { wonValue, pipelineValue };
}

/** Pipeline antigo deixou de contar após venda (WON) na mesma conversa. */
export function isPipelineClosureActiveForRollup(
  row: ClosureRollupRow,
  allRecords: ClosureRollupRow[],
): boolean {
  if (closureRecordContribution(row) !== "PIPELINE") return false;
  const convRecords = allRecords.filter((r) => r.conversationId === row.conversationId);
  const latest = pickLatestClosureRecord(convRecords);
  if (!latest || closureRecordContribution(latest) === "WON") return false;
  const [latestPipeline] = latestClosureRecordPerConversationAndBucket(convRecords, "PIPELINE");
  return latestPipeline != null && latestPipeline.sessionIndex === row.sessionIndex;
}

/** Exibir badge de valor no histórico (WON sempre; pipeline só se ainda ativo). */
export function shouldDisplayClosureValueBadge(
  row: ClosureRollupRow,
  allRecords: ClosureRollupRow[],
): boolean {
  const v = row.closureValue ?? 0;
  if (v <= 0) return false;
  const bucket = closureRecordContribution(row);
  if (bucket === "WON") return true;
  if (bucket === "PIPELINE") return isPipelineClosureActiveForRollup(row, allRecords);
  return false;
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
