export function mapNvoipCallErrorMessage(message: string, t: (key: string) => string): string {
  switch (message) {
    case "nvoip_not_configured":
      return t("nvoip.voice.notConfigured");
    case "nvoip_no_caller":
      return t("nvoip.voice.noCaller");
    case "nvoip_invalid_caller_use_ramal":
      return t("nvoip.voice.invalidCallerUseRamal");
    case "sip_not_registered":
      return t("nvoip.sip.notRegistered");
    default:
      return message;
  }
}

/** Warn only for phone-like values unlikely to be a SIP user id. PABX NumberSIP (e.g. 143087001) is valid. */
export function isLikelyNvoipNumbersipCaller(caller: string, accountNumbersip?: string): boolean {
  const c = caller.replace(/\D/g, "");
  if (!c || c.length < 2) return false;
  const ns = accountNumbersip?.replace(/\D/g, "");
  if (ns && c === ns) return false;
  return c.length >= 11;
}
