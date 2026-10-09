import { normalizePhoneE164 } from "@openconduit/shared";
import { normalizeLeadFinderPhone } from "./leadFinderPhone.js";

const NOT_A_CALLER = /^(inbound|outbound|anonymous|unknown|restricted|unavailable|sip)$/i;

/** Número de quem liga, em E.164, ou null quando não é um telefone de lead. */
export function sipInboundLeadPhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || NOT_A_CALLER.test(trimmed)) return null;
  return normalizeLeadFinderPhone(trimmed) ?? normalizePhoneE164(trimmed);
}
