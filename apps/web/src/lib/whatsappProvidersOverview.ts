import {
  isInboxWhatsappConfigured,
  isWhatsAppCloudApiProvider,
  parseInboxWhatsappFromChannelConfig,
  type InboxWhatsappProvider,
} from "@/lib/inboxWhatsappConfig";
import { isOrgWhatsappConfigured, whatsappProviderLabel, type WhatsappOrgSettingsSnapshot } from "@/lib/whatsappOrgConfig";

export type WhatsappProviderOverviewItem = {
  id: InboxWhatsappProvider;
  label: string;
  configured: boolean;
  isPrimary: boolean;
  inboxLabel?: string;
};

const PROVIDER_ORDER: InboxWhatsappProvider[] = [
  "meta",
  "360dialog",
  "evolution_go",
  "evolution",
  "twilio",
];

type WaInboxRow = {
  id: string;
  name?: string;
  isDefault?: boolean;
  channelConfig?: unknown;
};

export function collectWhatsappProviderOverview(
  settings: WhatsappOrgSettingsSnapshot | null | undefined,
  waInboxes: WaInboxRow[],
  primaryProvider: string,
): WhatsappProviderOverviewItem[] {
  const byId = new Map<InboxWhatsappProvider, WhatsappProviderOverviewItem>();

  const touch = (id: InboxWhatsappProvider, configured: boolean, inboxLabel?: string) => {
    const existing = byId.get(id);
    if (existing) {
      existing.configured = existing.configured || configured;
      if (inboxLabel && !existing.inboxLabel) existing.inboxLabel = inboxLabel;
      return;
    }
    byId.set(id, {
      id,
      label: whatsappProviderLabel(id),
      configured,
      isPrimary: false,
      inboxLabel,
    });
  };

  if (settings?.whatsappProvider) {
    const p = settings.whatsappProvider as InboxWhatsappProvider;
    touch(p, isOrgWhatsappConfigured(settings), "Organização");
  }

  for (const inbox of waInboxes) {
    const fields = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
    if (!fields.whatsappProvider) continue;
    const label = inbox.name?.trim() || (inbox.isDefault ? "Caixa predefinida" : "Caixa WhatsApp");
    touch(fields.whatsappProvider, isInboxWhatsappConfigured(fields), label);
  }

  const primary = (primaryProvider || settings?.whatsappProvider || "") as InboxWhatsappProvider;
  if (primary && byId.has(primary)) {
    byId.get(primary)!.isPrimary = true;
  } else if (primary) {
    touch(primary, false);
    byId.get(primary)!.isPrimary = true;
  }

  for (const id of PROVIDER_ORDER) {
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        label: whatsappProviderLabel(id),
        configured: false,
        isPrimary: id === primary,
        inboxLabel: undefined,
      });
    }
  }

  return PROVIDER_ORDER.map((id) => byId.get(id)!);
}

export function isCloudWhatsappProvider(provider: string): boolean {
  return isWhatsAppCloudApiProvider(provider);
}
