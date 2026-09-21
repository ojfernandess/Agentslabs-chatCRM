import {
  INBOX_CHANNEL_STYLES,
  inboxConnectionLabel,
  isInboxChannelId,
  type InboxChannelId,
} from "@/lib/inboxChannelUi";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

export type SuperAdminOrgInboxRow = {
  id: string;
  name: string;
  channelType: string;
  channelConfig?: unknown;
  ingestToken?: string | null;
};

export type SuperAdminOrgIntegrationEntry = {
  key: string;
  inboxId: string | null;
  inboxName: string;
  channelType: InboxChannelId | string;
  connectionLabel: string | null;
  webhookUrl: string | null;
  badgeClass: string;
};

function publicOrigin(): string {
  return window.location.origin.replace(/\/+$/, "");
}

function encodeToken(token: string): string {
  return encodeURIComponent(token.trim());
}

export function inboxIntegrationWebhookUrl(
  organizationId: string,
  inbox: Pick<SuperAdminOrgInboxRow, "id" | "channelType" | "ingestToken">,
): string | null {
  const base = publicOrigin();
  const token = inbox.ingestToken?.trim();
  switch (inbox.channelType) {
    case "WHATSAPP":
      return `${base}/webhooks/whatsapp/${organizationId}/${inbox.id}`;
    case "API":
      return token ? `${base}/api/v1/public/inbox/${encodeToken(token)}/inbound` : null;
    case "WEBSITE":
      return token ? `${base}/api/v1/public/inbox/${encodeToken(token)}/inbound` : null;
    case "TELEGRAM":
      return token ? `${base}/api/v1/public/channels/inboxes/${encodeToken(token)}/telegram` : null;
    case "FACEBOOK":
      return token ? `${base}/api/v1/public/channels/inboxes/${encodeToken(token)}/facebook` : null;
    case "INSTAGRAM":
      return token ? `${base}/api/v1/public/channels/inboxes/${encodeToken(token)}/instagram` : null;
    case "LINE":
      return token ? `${base}/api/v1/public/channels/inboxes/${encodeToken(token)}/line` : null;
    case "SMS":
    case "VOICE":
      return token ? `${base}/api/v1/public/channels/inboxes/${encodeToken(token)}/twilio` : null;
    case "EMAIL":
      return null;
    default:
      return null;
  }
}

export function legacyOrgWhatsappWebhookUrl(organizationId: string): string {
  return `${publicOrigin()}/webhooks/whatsapp/${organizationId}`;
}

export function buildOrgIntegrationEntries(
  organizationId: string,
  inboxes: SuperAdminOrgInboxRow[] | undefined,
  legacyWhatsappProvider: string | null | undefined,
): SuperAdminOrgIntegrationEntry[] {
  if (inboxes?.length) {
    return inboxes.map((inbox) => {
      const channelType = isInboxChannelId(inbox.channelType) ? inbox.channelType : inbox.channelType;
      const badgeClass = isInboxChannelId(inbox.channelType)
        ? INBOX_CHANNEL_STYLES[inbox.channelType].badge
        : INBOX_CHANNEL_STYLES.API.badge;
      return {
        key: inbox.id,
        inboxId: inbox.id,
        inboxName: inbox.name,
        channelType,
        connectionLabel: inboxConnectionLabel(inbox.channelType, inbox.channelConfig),
        webhookUrl: inboxIntegrationWebhookUrl(organizationId, inbox),
        badgeClass,
      };
    });
  }

  if (legacyWhatsappProvider?.trim()) {
    return [
      {
        key: "legacy-whatsapp",
        inboxId: null,
        inboxName: "WhatsApp (organização)",
        channelType: "WHATSAPP",
        connectionLabel: whatsappProviderLabel(legacyWhatsappProvider),
        webhookUrl: legacyOrgWhatsappWebhookUrl(organizationId),
        badgeClass: INBOX_CHANNEL_STYLES.WHATSAPP.badge,
      },
    ];
  }

  return [];
}

export function orgHasIntegrationChannel(
  inboxes: SuperAdminOrgInboxRow[] | undefined,
  legacyWhatsappProvider: string | null | undefined,
  channel: IntegrationFilterChannel,
): boolean {
  if (channel === "all") return true;
  if (inboxes?.some((inbox) => inbox.channelType === channel)) return true;
  return channel === "WHATSAPP" && Boolean(legacyWhatsappProvider?.trim());
}

export type IntegrationFilterChannel = "all" | InboxChannelId;

export function integrationFilterOptions(
  orgs: Array<{ inboxes?: SuperAdminOrgInboxRow[]; settings?: { whatsappProvider?: string | null } | null }>,
): IntegrationFilterChannel[] {
  const channels = new Set<InboxChannelId>();
  for (const org of orgs) {
    for (const inbox of org.inboxes ?? []) {
      if (isInboxChannelId(inbox.channelType)) channels.add(inbox.channelType);
    }
    if (org.settings?.whatsappProvider?.trim()) channels.add("WHATSAPP");
  }
  return ["all", ...Array.from(channels).sort()];
}
