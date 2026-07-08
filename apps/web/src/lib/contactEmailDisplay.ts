import {
  emailHtmlFromStoredContent,
  emailMessageDisplayBody,
  emailStoredContent,
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

export function emailThreadSubject(body: string | null | undefined, fallback: string): string {
  const line = body?.trim().split(/\r?\n/)[0]?.trim();
  if (!line || line.startsWith("<") || line.startsWith("<!--")) return fallback;
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
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

export { stripEmailQuotedContent };
