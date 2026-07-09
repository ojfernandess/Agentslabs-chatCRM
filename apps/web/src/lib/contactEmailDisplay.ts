import {
  emailHtmlFromStoredContent,
  emailMessageDisplayBody,
  emailStoredContent,
  emailSubjectFromBody,
  htmlToPlainTextForEmail,
  isEmailHtmlStoredContent,
  stripEmailQuotedContent,
} from "@openconduit/shared";

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

/** Assunto de um único body armazenado (inbound ou outbound). */
export function emailThreadSubject(body: string | null | undefined, fallback: string): string {
  const subject = emailSubjectFromBody(body)?.trim();
  if (!subject) return fallback;
  return subject.length > 90 ? `${subject.slice(0, 87)}…` : subject;
}

/**
 * Título do thread: prioriza a mensagem mais antiga com assunto válido,
 * depois a mais recente; evita usar a 1.ª linha do corpo de replies outbound legados.
 */
export function emailConversationSubject(
  messages: Array<{ body: string | null; direction?: string; createdAt?: string }> | null | undefined,
  fallback: string,
): string {
  if (!messages?.length) return fallback;

  const chronological = [...messages].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });

  for (const msg of chronological) {
    const subject = emailSubjectFromBody(msg.body)?.trim();
    if (subject) {
      return subject.length > 90 ? `${subject.slice(0, 87)}…` : subject;
    }
  }

  // Lista da inbox só traz a última mensagem — tentar essa.
  const last = messages[0];
  return emailThreadSubject(last?.body, fallback);
}

/** Pré-visualização em texto para listas (sem HTML cru). */
export function emailMessagePreviewText(body: string | null | undefined, maxLen = 120): string {
  const content = emailStoredContent(body);
  if (!content) return "";
  let plain = content;
  if (isEmailHtmlStoredContent(content)) {
    plain = htmlToPlainTextForEmail(emailHtmlFromStoredContent(content) ?? content);
  } else {
    plain = stripEmailQuotedContent(content);
  }
  const compact = plain.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
}

export function emailMessageContent(body: string | null | undefined): string {
  return emailMessageDisplayBody(body);
}

export { stripEmailQuotedContent, emailSubjectFromBody };
