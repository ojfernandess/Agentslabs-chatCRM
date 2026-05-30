/** Mapeia chaves comuns do formulário pré-chat para campos do contacto. */
const PRE_CHAT_NAME_KEYS = new Set(["fullname", "name", "nome"]);
const PRE_CHAT_EMAIL_KEYS = new Set(["emailaddress", "email", "e-mail"]);
const PRE_CHAT_PHONE_KEYS = new Set(["phonenumber", "phone", "telefone", "tel"]);

function normalizePreChatKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function pickPreChatValue(data: Record<string, string>, keys: Set<string>): string | null {
  for (const [rawKey, rawVal] of Object.entries(data)) {
    const val = rawVal.trim();
    if (!val) continue;
    if (keys.has(normalizePreChatKey(rawKey))) return val;
  }
  return null;
}

function formatPreChatNotes(data: Record<string, string>): string | null {
  const lines: string[] = [];
  for (const [key, rawVal] of Object.entries(data)) {
    const val = rawVal.trim();
    if (!val) continue;
    const norm = normalizePreChatKey(key);
    if (PRE_CHAT_NAME_KEYS.has(norm) || PRE_CHAT_EMAIL_KEYS.has(norm) || PRE_CHAT_PHONE_KEYS.has(norm)) {
      continue;
    }
    lines.push(`${key}: ${val}`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function mergeContactNotes(existing: string | null | undefined, addition: string): string {
  const base = existing?.trim() ?? "";
  if (!base) return addition;
  if (base.includes(addition)) return base;
  return `${base}\n${addition}`;
}

export function applyPreChatFormToContact(input: {
  participantName?: string;
  email?: string | null;
  visitorPhone?: string | null;
  preChatFormData?: Record<string, string> | null;
}): {
  name?: string;
  email?: string;
  notes?: string;
} {
  const formData = input.preChatFormData ?? {};
  const mergedData: Record<string, string> = { ...formData };
  if (input.participantName?.trim()) mergedData.name = input.participantName.trim();
  if (input.email?.trim()) mergedData.email = input.email.trim();
  if (input.visitorPhone?.trim()) mergedData.phone = input.visitorPhone.trim();

  const updates: { name?: string; email?: string; notes?: string } = {};

  const name = pickPreChatValue(mergedData, PRE_CHAT_NAME_KEYS);
  if (name) updates.name = name;

  const email = pickPreChatValue(mergedData, PRE_CHAT_EMAIL_KEYS);
  if (email) updates.email = email;

  const phone = pickPreChatValue(mergedData, PRE_CHAT_PHONE_KEYS);
  const customNotes = formatPreChatNotes(mergedData);
  const noteParts: string[] = [];
  if (phone) noteParts.push(`Telefone: ${phone}`);
  if (customNotes) noteParts.push(customNotes);
  if (noteParts.length) updates.notes = noteParts.join("\n");

  return updates;
}
