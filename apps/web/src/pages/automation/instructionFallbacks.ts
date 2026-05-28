export type InstructionFallbackAction = "transfer_human" | "transfer_team" | "set_pending" | "custom";

export type InstructionFallback = {
  id: string;
  /** Trecho das instruções principais que activa o fallback. */
  triggerText: string;
  action: InstructionFallbackAction;
  teamId?: string | null;
  teamName?: string | null;
  /** Instrução livre ou mensagem complementar. */
  customInstruction?: string | null;
};

export function newFallbackId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function parseInstructionFallbacks(raw: unknown): InstructionFallback[] {
  if (!Array.isArray(raw)) return [];
  const out: InstructionFallback[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const triggerText = typeof o.triggerText === "string" ? o.triggerText.trim() : "";
    if (!triggerText) continue;
    const action = o.action;
    if (
      action !== "transfer_human" &&
      action !== "transfer_team" &&
      action !== "set_pending" &&
      action !== "custom"
    ) {
      continue;
    }
    const teamId = typeof o.teamId === "string" ? o.teamId.trim() || null : null;
    const teamName = typeof o.teamName === "string" ? o.teamName.trim() || null : null;
    const customInstruction =
      typeof o.customInstruction === "string" ? o.customInstruction.trim() || null : null;
    if (action === "transfer_team" && !teamId) continue;
    if (action === "custom" && !customInstruction) continue;
    out.push({
      id: typeof o.id === "string" && o.id ? o.id : newFallbackId(),
      triggerText,
      action,
      teamId,
      teamName,
      customInstruction,
    });
  }
  return out;
}

type FallbackBlockLabels = {
  header: string;
  intro: string;
  triggerLabel: string;
  actionLabel: string;
  transferHuman: string;
  transferTeam: (name: string, id: string) => string;
  setPending: string;
  custom: (text: string) => string;
};

const LABELS_PT: FallbackBlockLabels = {
  header: "[OpenConduit — fallbacks de instrução]",
  intro:
    "Quando a situação da conversa corresponder ao «trecho gatilho» abaixo — ou seja, quando aplicaria essa parte das instruções principais (mesmo tema, intenção ou regra) — execute imediatamente a ação indicada, sem pedir confirmação extra, salvo se as instruções principais disserem o contrário.",
  triggerLabel: "Trecho gatilho",
  actionLabel: "Ação",
  transferHuman: "Transferir para atendimento humano — invoque `call_human`.",
  transferTeam: (name, id) =>
    `Transferir para a equipa «${name}» — invoque \`transfer_to_team\` com \`team_id\`: \`${id}\`.`,
  setPending: "Marcar conversa como pendente — invoque `set_conversation_status` com status PENDING.",
  custom: (text) => text,
};

const LABELS_EN: FallbackBlockLabels = {
  header: "[OpenConduit — instruction fallbacks]",
  intro:
    "When the situation in the conversation matches the «trigger excerpt» below — i.e. when you would apply that part of the main instructions (same topic, intent, or rule) — execute the indicated action immediately, without extra confirmation unless the main instructions say otherwise.",
  triggerLabel: "Trigger excerpt",
  actionLabel: "Action",
  transferHuman: "Transfer to human support — invoke `call_human`.",
  transferTeam: (name, id) =>
    `Transfer to team «${name}» — invoke \`transfer_to_team\` with \`team_id\`: \`${id}\`.`,
  setPending: "Mark conversation as pending — invoke `set_conversation_status` with status PENDING.",
  custom: (text) => text,
};

function describeAction(fb: InstructionFallback, L: FallbackBlockLabels): string {
  const extra = fb.customInstruction?.trim();
  const withExtra = (base: string) => (extra ? `${base} Antes ou durante: ${extra}` : base);

  switch (fb.action) {
    case "transfer_human":
      return withExtra(L.transferHuman);
    case "transfer_team":
      return withExtra(L.transferTeam(fb.teamName ?? fb.teamId ?? "team", fb.teamId ?? ""));
    case "set_pending":
      return withExtra(L.setPending);
    case "custom":
      return L.custom(fb.customInstruction ?? "");
    default:
      return "";
  }
}

const FALLBACK_MARKER_PT = "[OpenConduit — fallbacks de instrução]";
const FALLBACK_MARKER_EN = "[OpenConduit — instruction fallbacks]";

function stripInstructionFallbackBlocks(text: string): string {
  let result = text;
  for (const marker of [FALLBACK_MARKER_PT, FALLBACK_MARKER_EN]) {
    let idx = result.indexOf(marker);
    while (idx !== -1) {
      const autoEnd = result.indexOf("\n<!-- /openconduit:auto-prompt -->", idx);
      const nextOcSection = result.indexOf("\n[OpenConduit —", idx + marker.length);
      let end: number;
      if (autoEnd !== -1 && (nextOcSection === -1 || autoEnd < nextOcSection)) {
        end = autoEnd;
      } else if (nextOcSection !== -1) {
        end = nextOcSection;
      } else {
        end = result.length;
      }
      result = `${result.slice(0, idx).trimEnd()}${result.slice(end)}`;
      idx = result.indexOf(marker);
    }
  }
  return result.replace(/\n{3,}/g, "\n\n");
}

/** Garante que fallbacks guardados em promptBuilder chegam ao system prompt em runtime. */
export function mergeInstructionFallbacksIntoSystemPrompt(
  systemInstructions: string,
  fallbacks: InstructionFallback[],
  locale: "pt" | "en" = "pt",
): string {
  const without = stripInstructionFallbackBlocks(systemInstructions);
  const rows = fallbacks.filter((f) => f.triggerText.trim());
  if (rows.length === 0) return without.trimEnd();

  const fbBlock = buildInstructionFallbackBlock(rows, locale);
  if (!fbBlock) return without.trimEnd();

  const autoEnd = "\n<!-- /openconduit:auto-prompt -->";
  const endIdx = without.indexOf(autoEnd);
  if (endIdx !== -1) {
    return `${without.slice(0, endIdx).trimEnd()}\n\n${fbBlock}\n${without.slice(endIdx)}`;
  }

  return `${without.trimEnd()}\n\n${fbBlock}`;
}

/** Bloco de texto injectado no prompt automático (só quando há fallbacks). */
export function buildInstructionFallbackBlock(
  fallbacks: InstructionFallback[],
  locale: "pt" | "en" = "pt",
): string {
  const rows = fallbacks.filter((f) => f.triggerText.trim());
  if (rows.length === 0) return "";
  const L = locale === "en" ? LABELS_EN : LABELS_PT;
  const lines: string[] = [L.header, "", L.intro, ""];
  rows.forEach((fb, i) => {
    lines.push(`${i + 1}. **${L.triggerLabel}:** «${fb.triggerText.trim()}»`);
    lines.push(`   **${L.actionLabel}:** ${describeAction(fb, L)}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}
