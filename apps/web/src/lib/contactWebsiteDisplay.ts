export {
  CHANNEL_PARTICIPANT_PHONE_PREFIX,
  parseChannelParticipantPhone,
  isChannelParticipantPhone,
  isTelegramContactPhone,
  telegramParticipantId,
} from "@openconduit/shared";

import {
  isChannelParticipantPhone,
  isTelegramContactPhone,
  parseChannelParticipantPhone,
  telegramParticipantId,
  WEBSITE_PHONE_PREFIX,
} from "@openconduit/shared";

export {
  WEBSITE_PHONE_PREFIX,
  websiteParticipantId,
  isAnonymousWebsiteVisitorName,
  parseWebsiteSiteMeta,
  resolveWebsiteContactDisplayName,
} from "@openconduit/shared";

export function isWebsiteContactPhone(phone: string | null | undefined): boolean {
  return Boolean(phone?.startsWith(WEBSITE_PHONE_PREFIX));
}

/** Oculta identificadores internos oc|… na UI de telefone. */
export function websitePhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone || isWebsiteContactPhone(phone) || isChannelParticipantPhone(phone)) return null;
  return phone;
}

export type ContactPhoneDisplayLabels = {
  website?: string;
  telegram?: string;
};

/** Telefone para listagens: visitantes/canais mostram rótulo legível em vez do id interno. */
export function formatContactPhoneForDisplay(
  phone: string | null | undefined,
  siteOrLabels: string | ContactPhoneDisplayLabels = "Site",
): string | null {
  if (!phone) return null;
  const labels: ContactPhoneDisplayLabels =
    typeof siteOrLabels === "string" ? { website: siteOrLabels } : siteOrLabels;

  if (isWebsiteContactPhone(phone)) return labels.website ?? "Site";

  if (isTelegramContactPhone(phone)) {
    const id = telegramParticipantId(phone);
    const label = labels.telegram ?? "Telegram";
    return id ? `${label} · ${id}` : label;
  }

  const parsed = parseChannelParticipantPhone(phone);
  if (parsed) return `${parsed.channel} · ${parsed.participantId}`;

  return phone;
}
