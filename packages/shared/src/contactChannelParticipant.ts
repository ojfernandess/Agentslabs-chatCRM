/** Synthetic contact.phone keys for native channels (oc|CHANNEL|participantId). */
export const CHANNEL_PARTICIPANT_PHONE_PREFIX = "oc|";

export type ParsedChannelParticipantPhone = {
  channel: string;
  participantId: string;
};

export function parseChannelParticipantPhone(phone: string): ParsedChannelParticipantPhone | null {
  if (!phone.startsWith(CHANNEL_PARTICIPANT_PHONE_PREFIX)) return null;
  const rest = phone.slice(CHANNEL_PARTICIPANT_PHONE_PREFIX.length);
  const sep = rest.indexOf("|");
  if (sep <= 0) return null;
  const channel = rest.slice(0, sep);
  const participantId = rest.slice(sep + 1).trim();
  if (!channel || !participantId) return null;
  return { channel, participantId };
}

export function isChannelParticipantPhone(phone: string | null | undefined): boolean {
  return parseChannelParticipantPhone(phone ?? "") !== null;
}

export function isTelegramContactPhone(phone: string | null | undefined): boolean {
  return parseChannelParticipantPhone(phone ?? "")?.channel === "TELEGRAM";
}

export function telegramParticipantId(phone: string): string | null {
  const parsed = parseChannelParticipantPhone(phone);
  if (parsed?.channel !== "TELEGRAM") return null;
  return parsed.participantId;
}
