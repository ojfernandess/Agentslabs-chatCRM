export function mapNvoipCallErrorMessage(message: string, t: (key: string) => string): string {
  switch (message) {
    case "nvoip_not_configured":
      return t("nvoip.voice.notConfigured");
    case "nvoip_no_caller":
      return t("nvoip.voice.noCaller");
    case "nvoip_invalid_caller_use_ramal":
      return t("nvoip.voice.invalidCallerUseRamal");
    default:
      return message;
  }
}

/** Client-side hint: NumberSIP / phone-like ids are not valid SIP ramais. */
export function isLikelyNvoipNumbersipCaller(caller: string, accountNumbersip?: string): boolean {
  const c = caller.replace(/\D/g, "");
  if (!c || c.length < 2) return false;
  if (c.length >= 9) return true;
  const ns = accountNumbersip?.replace(/\D/g, "");
  return Boolean(ns && c === ns);
}
