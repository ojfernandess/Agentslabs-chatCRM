export type LeadValueRollupKind = "PIPELINE" | "WON" | "LOST" | "NONE";

/** Próximo passo sugerido ao finalizar conversa com este tipo de lead. */
export type LeadTypeClosurePlaybook = {
  /** Pré-marcar lembrete no modal de finalização (default: true para PIPELINE). */
  suggestReminder?: boolean;
  /** Dias após hoje para data sugerida do lembrete (default: 1). */
  reminderDueDays?: number;
  /** Modelo da nota; suporta {{closureReason}}. */
  reminderNoteTemplate?: string;
  /** Criar negócio mesmo sem valor monetário (PIPELINE/WON). */
  createDealWithoutValue?: boolean;
};

export function defaultClosurePlaybookForRollup(
  rollup: LeadValueRollupKind,
): LeadTypeClosurePlaybook {
  switch (rollup) {
    case "WON":
      return {
        suggestReminder: false,
        reminderDueDays: 7,
        createDealWithoutValue: true,
      };
    case "LOST":
      return {
        suggestReminder: true,
        reminderDueDays: 30,
        reminderNoteTemplate: "Recontactar — {{closureReason}}",
        createDealWithoutValue: false,
      };
    case "NONE":
      return {
        suggestReminder: false,
        createDealWithoutValue: false,
      };
    case "PIPELINE":
    default:
      return {
        suggestReminder: true,
        reminderDueDays: 1,
        reminderNoteTemplate: "Follow-up — {{closureReason}}",
        createDealWithoutValue: false,
      };
  }
}

export function parseLeadTypeClosurePlaybook(raw: unknown): LeadTypeClosurePlaybook | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: LeadTypeClosurePlaybook = {};
  if (typeof o.suggestReminder === "boolean") out.suggestReminder = o.suggestReminder;
  if (typeof o.reminderDueDays === "number" && o.reminderDueDays >= 0 && o.reminderDueDays <= 365) {
    out.reminderDueDays = Math.floor(o.reminderDueDays);
  }
  if (typeof o.reminderNoteTemplate === "string") {
    out.reminderNoteTemplate = o.reminderNoteTemplate.slice(0, 500);
  }
  if (typeof o.createDealWithoutValue === "boolean") {
    out.createDealWithoutValue = o.createDealWithoutValue;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function resolveLeadTypeClosurePlaybook(
  stored: unknown,
  valueRollup: LeadValueRollupKind,
): LeadTypeClosurePlaybook {
  const parsed = parseLeadTypeClosurePlaybook(stored);
  const defaults = defaultClosurePlaybookForRollup(valueRollup);
  return {
    ...defaults,
    ...(parsed ?? {}),
  };
}

export function formatClosurePlaybookReminderNote(
  template: string | undefined,
  closureReason: string,
): string {
  const base = (template ?? "Follow-up — {{closureReason}}").trim();
  const reason = closureReason.trim() || "sem resumo";
  return base.replace(/\{\{closureReason\}\}/g, reason).slice(0, 2000);
}

export function suggestReminderDueDateIso(dueDays: number | undefined, hour = 9, minute = 0): string {
  const days = dueDays ?? 1;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export function shouldCreateDealOnConversationClosure(input: {
  closureValue: number | null | undefined;
  valueRollup: LeadValueRollupKind;
  playbook: LeadTypeClosurePlaybook;
}): boolean {
  const val = input.closureValue ?? 0;
  if (val > 0) return true;
  if (input.valueRollup !== "PIPELINE" && input.valueRollup !== "WON") return false;
  return input.playbook.createDealWithoutValue === true;
}
