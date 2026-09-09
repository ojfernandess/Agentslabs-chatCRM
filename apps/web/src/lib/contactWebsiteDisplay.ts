export {
  WEBSITE_PHONE_PREFIX,
  websiteParticipantId,
  isAnonymousWebsiteVisitorName,
  parseWebsiteSiteMeta,
  resolveWebsiteContactDisplayName,
} from "@openconduit/shared";

import { WEBSITE_PHONE_PREFIX } from "@openconduit/shared";

export function isWebsiteContactPhone(phone: string | null | undefined): boolean {
  return Boolean(phone?.startsWith(WEBSITE_PHONE_PREFIX));
}

/** Oculta o identificador interno oc|WEBSITE|… na UI. */
export function websitePhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone || isWebsiteContactPhone(phone)) return null;
  return phone;
}
