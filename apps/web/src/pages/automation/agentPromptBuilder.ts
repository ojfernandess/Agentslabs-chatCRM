import {
  buildInstructionFallbackBlock,
  type InstructionFallback,
} from "./instructionFallbacks";

/** Marker delimiting auto-generated prompt instructions (stripped on load for the “builder” textarea). */
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

type Translate = (key: string) => string;

/**
 * Nome da função no agente nativo OpenAI — **deve coincidir** com `openAiFunctionNameForAutomationTool` na API (`automationHttpToolExecute.ts`).
 */
export function nativeOpenAiToolFunctionName(toolId: string): string {
  return `oc_tool_${toolId.replace(/-/g, "")}`;
}

/** Inverso de `nativeOpenAiToolFunctionName` — alinhado com `parseAutomationToolIdFromOpenAiName` na API. */
export function parseAutomationToolIdFromOpenAiName(name: string): string | null {
  if (!name.startsWith("oc_tool_")) return null;
  const hex = name.slice("oc_tool_".length);
  if (!/^[a-f0-9]{32}$/i.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const AUTOMATION_TOOL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve UUID da ferramenta a partir de campos persistidos no log de execução. */
export function resolveAutomationToolIdFromLogNode(nodeId: string, nodeName: string): string | null {
  const fromId = parseAutomationToolIdFromOpenAiName(nodeId);
  if (fromId) return fromId;
  const stripped = nodeName.replace(/^Tool:\s*/i, "").trim();
  const fromName = parseAutomationToolIdFromOpenAiName(stripped);
  if (fromName) return fromName;
  const ocMatch =
    nodeName.match(/oc_tool_[a-f0-9]{32}/i)?.[0] ?? nodeId.match(/oc_tool_[a-f0-9]{32}/i)?.[0];
  if (ocMatch) return parseAutomationToolIdFromOpenAiName(ocMatch);
  if (AUTOMATION_TOOL_UUID_RE.test(nodeId)) return nodeId;
  return null;
}

export type ConnectedToolInstructionRow = { name: string; instruction: string; toolId: string };
export type ConnectedTagInstructionRow = { name: string; instruction: string; tagId: string };
export type TeamTransferHint = { teamId: string; teamName: string; instruction: string };

export type EscalationPromptContext = {
  mode: string;
  targetTeamId?: string | null;
  targetTeamName?: string | null;
  keywords?: string;
  conditions?: string;
  transferMessage?: string;
};

export function buildPromptAutoInstructionBlock(input: {
  nativeTools: Record<string, boolean>;
  linkedArticleTitles: string[];
  connectedToolNames: string[];
  connectedToolInstructions?: ConnectedToolInstructionRow[];
  connectedTagInstructions?: ConnectedTagInstructionRow[];
  teamTransferHints?: TeamTransferHint[];
  escalation?: EscalationPromptContext | null;
  instructionFallbacks?: InstructionFallback[];
  locale?: "pt" | "en";
  t: Translate;
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
    locale = "pt",
    t,
  } = input;
  const lines: string[] = [];

  lines.push(t("automationPage.promptBuilderAutoHeader"));
  lines.push("");

  const kbOn = nativeTools.knowledge_search === true;
  if (kbOn) {
    if (linkedArticleTitles.length > 0) {
      lines.push(t("automationPage.promptBuilderKbLinkedIntro"));
      for (const title of linkedArticleTitles.slice(0, 12)) {
        lines.push(`- ${title}`);
      }
      lines.push("");
      lines.push(t("automationPage.promptBuilderKbLinkedOutro"));
    } else {
      lines.push(t("automationPage.promptBuilderKbGeneric"));
    }
    lines.push("");
  }

  const nativeLines: string[] = [];
  const pushNative = (key: string, labelKey: string) => {
    if (nativeTools[key] !== true) return;
    if (key === "knowledge_search") return;
    const label = t(labelKey);
    const hint = t(`automationPage.promptBuilderHint_${key}`);
    nativeLines.push(`• ${label}: ${hint}`);
  };

  pushNative("list_teams", "automationPage.agentTool_list_teams");
  pushNative("list_pipeline_stages", "automationPage.agentTool_list_pipeline_stages");
  pushNative("assign_team_to_conversation", "automationPage.agentTool_assign_team_to_conversation");
  pushNative("transfer_to_team", "automationPage.agentTool_transfer_to_team");
  pushNative("set_conversation_status", "automationPage.agentTool_set_conversation_status");
  pushNative("list_google_calendars", "automationPage.agentTool_list_google_calendars");
  pushNative("scheduling_google", "automationPage.agentTool_scheduling_google");
  pushNative("scheduling_outlook", "automationPage.agentTool_scheduling_outlook");
  pushNative("call_human", "automationPage.agentTool_call_human");
  pushNative("assign_contact_tags", "automationPage.agentTool_assign_contact_tags");
  pushNative("end_conversation", "automationPage.agentTool_end_conversation");
  pushNative("ping", "automationPage.agentTool_ping");

  if (nativeLines.length) {
    lines.push(t("automationPage.promptBuilderNativeSection"));
    lines.push(...nativeLines);
    lines.push("");
  }

  if (connectedToolNames.length > 0) {
    lines.push(t("automationPage.promptBuilderCustomToolsSection"));
    lines.push(connectedToolNames.slice(0, 24).join(", "));
    lines.push("");
  }

  const ctInstr = (connectedToolInstructions ?? []).filter((x) => x.name && x.instruction?.trim() && x.toolId);
  if (ctInstr.length) {
    lines.push(t("automationPage.promptBuilderConnectedInstrSection"));
    for (const row of ctInstr) {
      lines.push(`**${row.name}**`);
      lines.push(
        t("automationPage.promptBuilderConnectedToolNativeFnLine").replace("{fn}", nativeOpenAiToolFunctionName(row.toolId)),
      );
      lines.push(row.instruction.trim());
      lines.push("");
    }
  }

  const tagInstr = (connectedTagInstructions ?? []).filter((x) => x.name && x.instruction?.trim() && x.tagId);
  if (tagInstr.length && nativeTools.assign_contact_tags === true) {
    lines.push(t("automationPage.promptBuilderConnectedTagsSection"));
    lines.push(t("automationPage.promptBuilderConnectedTagsActionHint"));
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
    lines.push(t("automationPage.promptBuilderTeamHintsSection"));
    for (const h of teamHintRows) {
      lines.push(`- **${h.teamName}** (\`team_id\`: \`${h.teamId}\`)`);
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
    lines.push(t("automationPage.promptBuilderEscalationSection"));
    if (esc.targetTeamId && esc.targetTeamName) {
      lines.push(
        t("automationPage.promptBuilderEscalationTeamLine")
          .replace("{name}", esc.targetTeamName)
          .replace("{id}", esc.targetTeamId),
      );
      lines.push("");
    }
    if (esc.mode) {
      lines.push(`${t("automationPage.promptBuilderEscalationModeLabel")}: ${esc.mode}`);
    }
    if (esc.keywords?.trim()) {
      lines.push(`${t("automationPage.promptBuilderEscalationKeywordsLabel")}: ${esc.keywords.trim()}`);
    }
    if (esc.conditions?.trim()) {
      lines.push(`${t("automationPage.promptBuilderEscalationConditionsLabel")}:`);
      lines.push(esc.conditions.trim());
    }
    if (esc.transferMessage?.trim()) {
      lines.push(`${t("automationPage.promptBuilderEscalationTransferLabel")}:`);
      lines.push(esc.transferMessage.trim());
    }
    if (esc.targetTeamId && canTeamTransfer) {
      lines.push("");
      lines.push(t("automationPage.promptBuilderEscalationActionHint"));
    }
    lines.push("");
  }

  const fbBlock = buildInstructionFallbackBlock(instructionFallbacks ?? [], locale);
  if (fbBlock) {
    lines.push(fbBlock);
    lines.push("");
  }

  return lines.join("\n").trim();
}
