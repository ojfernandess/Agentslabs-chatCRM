import { buildEilHelpSections } from "@/lib/eil/helpSections.js";
import {
  extractToolEil,
  parseToolEilJson,
  toolHasEilConfig,
  type ParsedToolEilResult,
  type ToolEilConfigDraft,
} from "@/lib/eil/toolConfig.js";
import { ToolEilVisualBuilder } from "./eil/ToolEilVisualBuilder.js";
import type { AutomationToolsTranslate } from "./automationToolTypes.js";

export type { ToolEilConfigDraft, ParsedToolEilResult };
export { extractToolEil, parseToolEilJson, toolHasEilConfig };

type Props = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  json: string;
  onJsonChange: (json: string) => void;
  t: AutomationToolsTranslate;
  locale?: "pt" | "en";
  toolName?: string;
  parametersSchemaJson?: string;
};

export function ToolEilConfigSection({
  enabled,
  onEnabledChange,
  json,
  onJsonChange,
  t,
  locale = "pt",
  toolName,
  parametersSchemaJson,
}: Props) {
  const helpSections = buildEilHelpSections(t);
  return (
    <ToolEilVisualBuilder
      enabled={enabled}
      onEnabledChange={onEnabledChange}
      json={json}
      onJsonChange={onJsonChange}
      t={t}
      locale={locale}
      helpSections={helpSections}
      toolName={toolName}
      parametersSchemaJson={parametersSchemaJson}
    />
  );
}
