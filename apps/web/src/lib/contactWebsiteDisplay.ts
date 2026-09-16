export {
  CHANNEL_PARTICIPANT_PHONE_PREFIX,
  parseChannelParticipantPhone,
  isChannelParticipantPhone,
  isTelegramContactPhone,
  telegramParticipantId,
  extractContactMobilePhoneFromNotes,
  resolveContactMobilePhone,
  resolveContactDialPhone,
} from "@openconduit/shared";

import {
  isChannelParticipantPhone,
  isTelegramContactPhone,
  parseChannelParticipantPhone,
  resolveContactMobilePhone,
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

export type ContactPhoneDisplayInput = {
  phone: string | null | undefined;
  mobilePhone?: string | null;
  notes?: string | null;
};

/** Telefone para listagens: prioriza celular real; senão rótulo legível do canal. */
export function formatContactPhoneForDisplay(
  phoneOrContact: string | ContactPhoneDisplayInput | null | undefined,
  siteOrLabels: string | ContactPhoneDisplayLabels = "Site",
): string | null {
  const contact: ContactPhoneDisplayInput =
    phoneOrContact != null && typeof phoneOrContact === "object"
      ? phoneOrContact
      : { phone: phoneOrContact ?? "" };

  const mobile = resolveContactMobilePhone(contact);
  if (mobile) return mobile;

  const phone = contact.phone;
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
