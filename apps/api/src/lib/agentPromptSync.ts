import {
  buildInstructionFallbackBlock,
  parseInstructionFallbacks,
  type InstructionFallback,
} from "./instructionFallbacks.js";

export const OC_AUTO_PROMPT_START = "\n\n<!-- openconduit:auto-prompt v1 -->\n";
export const OC_AUTO_PROMPT_END = "\n<!-- /openconduit:auto-prompt -->\n";

export function splitStoredSystemInstructions(full: string): { userCore: string } {
  const start = full.indexOf(OC_AUTO_PROMPT_START);
  if (start === -1) return { userCore: full };
  return { userCore: full.slice(0, start).trimEnd() };
}

export function mergeSystemWithAutoBlock(userCore: string, autoInner: string): string {
  const u = userCore.trimEnd();
  const a = autoInner.trim();
  if (!a) return u;
  return `${u}${OC_AUTO_PROMPT_START}${a}${OC_AUTO_PROMPT_END}`;
}

export function nativeOpenAiToolFunctionName(toolId: string): string {
  return `oc_tool_${toolId.replace(/-/g, "")}`;
}

export type SyncedConnectedToolInstructionRow = { name: string; instruction: string; toolId: string };
export type SyncedConnectedTagInstructionRow = { name: string; instruction: string; tagId: string };
export type SyncedTeamTransferHint = { teamId: string; teamName: string; instruction: string };

export type SyncedEscalationPromptContext = {
  mode: string;
  targetTeamId?: string | null;
  targetTeamName?: string | null;
  keywords?: string;
  conditions?: string;
  transferMessage?: string;
};

export function buildSyncedPromptAutoInstructionBlock(input: {
  nativeTools: Record<string, boolean>;
  linkedArticleTitles: string[];
  connectedToolNames: string[];
  connectedToolInstructions?: SyncedConnectedToolInstructionRow[];
  connectedTagInstructions?: SyncedConnectedTagInstructionRow[];
  teamTransferHints?: SyncedTeamTransferHint[];
  escalation?: SyncedEscalationPromptContext | null;
  instructionFallbacks?: InstructionFallback[];
}): string {
  const {
    nativeTools,
    linkedArticleTitles,
    connectedToolNames,
    connectedToolInstructions,
    connectedTagInstructions,
    teamTransferHints,
    escalation,
    instructionFallbacks,
  } = input;
  const lines: string[] = [];

  lines.push("Instruções automáticas (sincronizadas pelo OpenConduit)");
  lines.push("");

  if (nativeTools.knowledge_search === true) {
    if (linkedArticleTitles.length > 0) {
      lines.push("Base de conhecimento ligada (priorize estes artigos):");
      for (const title of linkedArticleTitles.slice(0, 12)) {
        lines.push(`- ${title}`);
      }
      lines.push("");
    } else {
      lines.push("Use a base de conhecimento para factos da organização antes de dizer que vai verificar.");
      lines.push("");
    }
  }

  if (connectedToolNames.length > 0) {
    lines.push("Ferramentas HTTP/Webhook ligadas a este agente:");
    lines.push(connectedToolNames.slice(0, 24).join(", "));
    lines.push("");
  }

  const ctInstr = (connectedToolInstructions ?? []).filter((x) => x.name && x.instruction?.trim() && x.toolId);
  if (ctInstr.length) {
    lines.push("Instruções por ferramenta ligada:");
    lines.push("");
    for (const row of ctInstr) {
      lines.push(`**${row.name}**`);
      lines.push(`Função: ${nativeOpenAiToolFunctionName(row.toolId)}`);
      lines.push(row.instruction.trim());
      lines.push("");
    }
  }

  const tagInstr = (connectedTagInstructions ?? []).filter((x) => x.name && x.instruction?.trim() && x.tagId);
  if (tagInstr.length && nativeTools.assign_contact_tags === true) {
    lines.push("Instruções por etiqueta:");
    lines.push("");
    for (const row of tagInstr) {
      lines.push(`**${row.name}** (\`tag_id\`: \`${row.tagId}\`)`);
      lines.push(row.instruction.trim());
      lines.push("");
    }
  }

  const canTeamTransfer =
    nativeTools.assign_team_to_conversation === true ||
    nativeTools.transfer_to_team === true ||
    nativeTools.list_teams === true;
  const teamHintRows = (teamTransferHints ?? []).filter((x) => x.teamId && x.instruction?.trim());
  if (teamHintRows.length && canTeamTransfer) {
    lines.push("Instruções por equipa (transferência):");
    for (const h of teamHintRows) {
      lines.push(`- ${h.teamName} (team_id: ${h.teamId})`);
      lines.push(h.instruction.trim());
      lines.push("");
    }
  }

  const esc = escalation;
  if (
    esc &&
    (esc.targetTeamId ||
      (esc.keywords && esc.keywords.trim()) ||
      (esc.conditions && esc.conditions.trim()) ||
      (esc.transferMessage && esc.transferMessage.trim()))
  ) {
    lines.push("Regras de escalonamento:");
    if (esc.targetTeamId && esc.targetTeamName) {
      lines.push(`Equipa destino: ${esc.targetTeamName} (${esc.targetTeamId})`);
      lines.push("");
    }
    if (esc.mode) lines.push(`Modo: ${esc.mode}`);
    if (esc.keywords?.trim()) lines.push(`Palavras-chave: ${esc.keywords.trim()}`);
    if (esc.conditions?.trim()) {
      lines.push("Condições:");
      lines.push(esc.conditions.trim());
    }
    if (esc.transferMessage?.trim()) {
      lines.push("Mensagem de transferência:");
      lines.push(esc.transferMessage.trim());
    }
    if (esc.targetTeamId && canTeamTransfer) {
      lines.push("");
      lines.push("Ao escalar, use transfer_to_team com team_id acima (quando aplicável).");
    }
    lines.push("");
  }

  const fbBlock = buildInstructionFallbackBlock(instructionFallbacks ?? []);
  if (fbBlock) {
    lines.push(fbBlock);
    lines.push("");
  }

  return lines.join("\n").trim();
}

export { parseInstructionFallbacks };

