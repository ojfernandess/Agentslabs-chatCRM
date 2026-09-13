import type { EilHelpSection } from "@/pages/automation/eil/EilHelpHint.js";

type Translate = (key: string) => string;

export function buildEilHelpSections(t: Translate): EilHelpSection[] {
  return [
    { kind: "text", title: t("automationPage.agentEilHelpWhat"), body: t("automationPage.agentEilHelpWhatBody") },
    { kind: "text", title: t("automationPage.agentEilHelpWhenActive"), body: t("automationPage.agentEilHelpWhenActiveBody") },
    { kind: "text", title: t("automationPage.agentEilHelpPracticalSummary"), body: t("automationPage.agentEilHelpPracticalSummaryBody") },
    { kind: "text", title: t("automationPage.agentEilHelpAgentConfig"), body: t("automationPage.agentEilHelpAgentConfigBody") },
    { kind: "text", title: t("automationPage.agentEilHelpPolicyFormat"), body: t("automationPage.agentEilHelpPolicyFormatBody") },
    { kind: "text", title: t("automationPage.agentEilHelpDefaultPolicy"), body: t("automationPage.agentEilHelpDefaultPolicyBody") },
    { kind: "text", title: t("automationPage.agentEilHelpToolMeta"), body: t("automationPage.agentEilHelpToolMetaBody") },
    {
      kind: "runtime-flow",
      title: t("automationPage.agentEilHelpRuntime"),
      intro: t("automationPage.agentEilHelpRuntimeIntro"),
      steps: [
        t("automationPage.agentEilHelpRuntimeStep1"),
        t("automationPage.agentEilHelpRuntimeStep2"),
        t("automationPage.agentEilHelpRuntimeStep3"),
        t("automationPage.agentEilHelpRuntimeStep4"),
        t("automationPage.agentEilHelpRuntimeStep5"),
        t("automationPage.agentEilHelpRuntimeStep6"),
      ],
    },
  ];
}
