export function contactEmailDisplay(contact: {
  email?: string | null;
  phone: string;
}): string | null {
  const direct = contact.email?.trim();
  if (direct && direct.includes("@")) return direct;
  const prefix = "oc|EMAIL|";
  if (contact.phone.startsWith(prefix)) {
    const participant = contact.phone.slice(prefix.length).trim();
    if (participant.includes("@")) return participant;
  }
  return null;
}

export function emailThreadSubject(body: string | null | undefined, fallback: string): string {
  const line = body?.trim().split(/\r?\n/)[0]?.trim();
  if (!line) return fallback;
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

/** Corpo do e-mail sem a primeira linha (assunto) quando salvo como "assunto\\n\\ncorpo". */
export function emailMessageContent(body: string | null | undefined): string {
  const raw = body?.trim();
  if (!raw) return "";
  const split = raw.split(/\r?\n\r?\n/);
  if (split.length >= 2 && split[0]?.trim()) {
    return split.slice(1).join("\n\n").trim();
  }
  return raw;
}
