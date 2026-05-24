import {
  isWhatsAppCloudApiProvider,
  parseInboxWhatsappFromChannelConfig,
} from "@/lib/inboxWhatsappConfig";
import type { InboxOption, TemplateOption } from "@/pages/broadcasts/campaignTypes";

export function isEvolutionWhatsappProvider(provider: string | null | undefined): boolean {
  return provider === "evolution" || provider === "evolution_go";
}

export function whatsappProviderForInbox(inbox: InboxOption | undefined): string | null {
  if (!inbox || inbox.channelType !== "WHATSAPP") return null;
  return parseInboxWhatsappFromChannelConfig(inbox.channelConfig).whatsappProvider ?? null;
}

/**
 * Filtra modelos conforme o provider da caixa WhatsApp selecionada.
 * Evolution: modelos locais (sem providerTemplateId). Meta/360dialog: modelos sincronizados WABA.
 */
export function filterTemplatesForWhatsappInbox(
  templates: TemplateOption[],
  inbox: InboxOption | undefined,
  options?: { allowVariableTemplates?: boolean },
): TemplateOption[] {
  if (!inbox || inbox.channelType !== "WHATSAPP") return [];

  const provider = whatsappProviderForInbox(inbox);
  let list = templates;

  if (isWhatsAppCloudApiProvider(provider ?? "")) {
    list = list.filter((tpl) => Boolean(tpl.providerTemplateId?.trim()));
  } else if (isEvolutionWhatsappProvider(provider)) {
    list = list.filter((tpl) => !tpl.providerTemplateId?.trim());
  }

  if (!options?.allowVariableTemplates) {
    list = list.filter((tpl) => (tpl.bodyVariableCount ?? 0) === 0);
  }

  return list;
}

export function templateOptionStatusSuffix(
  tpl: TemplateOption,
  t: (key: string) => string,
): string {
  if (!tpl.providerTemplateId?.trim()) {
    return ` (${t("settings.templatesStatusReady")})`;
  }
  if (tpl.isApproved) return "";
  return ` (${t("broadcastPage.followUpTplPending")})`;
}
