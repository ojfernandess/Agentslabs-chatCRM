import { isChannelParticipantPhone } from "./contactChannelParticipant.js";

/** Extrai telefone legado gravado em notas pelo pré-chat (`Telefone: …`). */
export function extractContactMobilePhoneFromNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  for (const line of notes.split("\n")) {
    const match = /^Telefone:\s*(.+)$/i.exec(line.trim());
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function resolveContactMobilePhone(contact: {
  phone?: string | null;
  mobilePhone?: string | null;
  notes?: string | null;
}): string | null {
  if (contact.mobilePhone?.trim()) return contact.mobilePhone.trim();
  const phone = contact.phone ?? "";
  if (isChannelParticipantPhone(phone)) {
    return extractContactMobilePhoneFromNotes(contact.notes);
  }
  return null;
}

/** Telefone utilizável para ligações/SMS/WhatsApp outbound (não a chave interna do canal). */
export function resolveContactDialPhone(contact: {
  phone?: string | null;
  mobilePhone?: string | null;
  notes?: string | null;
}): string | null {
  const mobile = resolveContactMobilePhone(contact);
  if (mobile) return mobile;
  const phone = contact.phone ?? "";
  if (isChannelParticipantPhone(phone)) return null;
  return phone || null;
}
