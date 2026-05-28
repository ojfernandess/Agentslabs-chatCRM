export type InstructionFallbackAction = "transfer_human" | "transfer_team" | "set_pending" | "custom";

export type InstructionFallback = {
  id: string;
  triggerText: string;
  action: InstructionFallbackAction;
  teamId?: string | null;
  teamName?: string | null;
  customInstruction?: string | null;
};

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
      id: typeof o.id === "string" && o.id ? o.id : `fb_${out.length}`,
      triggerText,
      action,
      teamId,
      teamName,
      customInstruction,
    });
  }
  return out;
}

export function buildInstructionFallbackBlock(
  fallbacks: InstructionFallback[],
  locale: "pt" | "en" = "pt",
): string {
  const rows = fallbacks.filter((f) => f.triggerText.trim());
  if (rows.length === 0) return "";

  const isEn = locale === "en";
  const lines: string[] = [
    isEn ? "[OpenConduit — instruction fallbacks]" : "[OpenConduit — fallbacks de instrução]",
    "",
    isEn
      ? "When the situation in the conversation matches the «trigger excerpt» below — i.e. when you would apply that part of the main instructions (same topic, intent, or rule) — execute the indicated action immediately, without extra confirmation unless the main instructions say otherwise."
      : "Quando a situação da conversa corresponder ao «trecho gatilho» abaixo — ou seja, quando aplicaria essa parte das instruções principais (mesmo tema, intenção ou regra) — execute imediatamente a ação indicada, sem pedir confirmação extra, salvo se as instruções principais disserem o contrário.",
    "",
  ];

  rows.forEach((fb, i) => {
    const triggerLabel = isEn ? "Trigger excerpt" : "Trecho gatilho";
    const actionLabel = isEn ? "Action" : "Ação";
    let actionText = "";
    const extra = fb.customInstruction?.trim();
    const withExtra = (base: string) => (extra ? `${base} Antes ou durante: ${extra}` : base);

    switch (fb.action) {
      case "transfer_human":
        actionText = withExtra(
          isEn
            ? "Transfer to human support — invoke `call_human`."
            : "Transferir para atendimento humano — invoque `call_human`.",
        );
        break;
      case "transfer_team":
        actionText = withExtra(
          isEn
            ? `Transfer to team «${fb.teamName ?? fb.teamId}» — invoke \`transfer_to_team\` with \`team_id\`: \`${fb.teamId}\`.`
            : `Transferir para a equipa «${fb.teamName ?? fb.teamId}» — invoque \`transfer_to_team\` com \`team_id\`: \`${fb.teamId}\`.`,
        );
        break;
      case "set_pending":
        actionText = withExtra(
          isEn
            ? "Mark conversation as pending — invoke `set_conversation_status` with status PENDING."
            : "Marcar conversa como pendente — invoque `set_conversation_status` com status PENDING.",
        );
        break;
      case "custom":
        actionText = fb.customInstruction ?? "";
        break;
    }
    lines.push(`${i + 1}. **${triggerLabel}:** «${fb.triggerText.trim()}»`);
    lines.push(`   **${actionLabel}:** ${actionText}`);
    lines.push("");
  });

  return lines.join("\n").trim();
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
