type Translate = (key: string) => string;

export function buildEilHelpSections(t: Translate): Array<{ title: string; body: string }> {
  return [
    { title: t("automationPage.agentEilHelpWhat"), body: t("automationPage.agentEilHelpWhatBody") },
    { title: t("automationPage.agentEilHelpAgentConfig"), body: t("automationPage.agentEilHelpAgentConfigBody") },
    { title: t("automationPage.agentEilHelpPolicyFormat"), body: t("automationPage.agentEilHelpPolicyFormatBody") },
    { title: t("automationPage.agentEilHelpDefaultPolicy"), body: t("automationPage.agentEilHelpDefaultPolicyBody") },
    { title: t("automationPage.agentEilHelpToolMeta"), body: t("automationPage.agentEilHelpToolMetaBody") },
    { title: t("automationPage.agentEilHelpRuntime"), body: t("automationPage.agentEilHelpRuntimeBody") },
  ];
}
