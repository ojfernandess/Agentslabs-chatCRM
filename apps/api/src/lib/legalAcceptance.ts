import { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from "@openconduit/shared";

export { LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION };

export function userRequiresLegalAcceptance(user: {
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  privacyAcceptedAt: Date | null;
  privacyVersion: string | null;
}): boolean {
  if (!user.termsAcceptedAt || user.termsVersion !== LEGAL_TERMS_VERSION) return true;
  if (!user.privacyAcceptedAt || user.privacyVersion !== LEGAL_PRIVACY_VERSION) return true;
  return false;
}

export function legalAcceptanceData(now = new Date()) {
  return {
    termsAcceptedAt: now,
    termsVersion: LEGAL_TERMS_VERSION,
    privacyAcceptedAt: now,
    privacyVersion: LEGAL_PRIVACY_VERSION,
  };
}
