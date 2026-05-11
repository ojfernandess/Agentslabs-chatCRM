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

export function buildPromptAutoInstructionBlock(input: {
  nativeTools: Record<string, boolean>;
  linkedArticleTitles: string[];
  connectedToolNames: string[];
  t: Translate;
}): string {
  const { nativeTools, linkedArticleTitles, connectedToolNames, t } = input;
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
  pushNative("set_conversation_status", "automationPage.agentTool_set_conversation_status");
  pushNative("list_google_calendars", "automationPage.agentTool_list_google_calendars");
  pushNative("scheduling_google", "automationPage.agentTool_scheduling_google");
  pushNative("scheduling_outlook", "automationPage.agentTool_scheduling_outlook");
  pushNative("call_human", "automationPage.agentTool_call_human");
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

  return lines.join("\n").trim();
}
