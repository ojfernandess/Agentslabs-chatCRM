import { format } from "date-fns";
import type { Locale } from "date-fns";

export interface ContactHistoryExportMessage {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  createdAt: string;
  isPrivate: boolean;
  conversation: {
    id: string;
    inbox: { channelType: string; name: string } | null;
  };
}

export interface ContactHistoryExportLabels {
  title: string;
  contact: string;
  phone: string;
  exportedAt: string;
  inbound: string;
  outbound: string;
  attachment: (type: string) => string;
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60) || "contato";
}

function publicMessages(messages: ContactHistoryExportMessage[]): ContactHistoryExportMessage[] {
  return messages.filter((m) => !m.isPrivate);
}

function channelLabel(msg: ContactHistoryExportMessage): string {
  return msg.conversation.inbox?.name ?? msg.conversation.inbox?.channelType ?? "—";
}

function messageBody(msg: ContactHistoryExportMessage, labels: ContactHistoryExportLabels): string {
  const text = msg.body?.trim();
  if (text) return text;
  if (msg.type !== "TEXT") return labels.attachment(msg.type);
  return "";
}

export function buildContactHistoryText(
  contact: { name: string; phone: string },
  messages: ContactHistoryExportMessage[],
  labels: ContactHistoryExportLabels,
  dateLocale: Locale,
): string {
  const rows = publicMessages(messages);
  const lines: string[] = [
    labels.title,
    `${labels.contact}: ${contact.name}`,
    `${labels.phone}: ${contact.phone}`,
    `${labels.exportedAt}: ${format(new Date(), "PPpp", { locale: dateLocale })}`,
    "",
  ];

  for (const msg of rows) {
    const when = format(new Date(msg.createdAt), "PPpp", { locale: dateLocale });
    const who = msg.direction === "INBOUND" ? labels.inbound : labels.outbound;
    lines.push(`--- [${when}] ${channelLabel(msg)} · ${who} ---`);
    lines.push(messageBody(msg, labels));
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function buildContactHistoryJson(
  contact: { id: string; name: string; phone: string },
  messages: ContactHistoryExportMessage[],
): string {
  const payload = {
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
    },
    exportedAt: new Date().toISOString(),
    messages: publicMessages(messages).map((msg) => ({
      id: msg.id,
      conversationId: msg.conversation.id,
      direction: msg.direction,
      type: msg.type,
      body: msg.body,
      createdAt: msg.createdAt,
      channel: channelLabel(msg),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function downloadContactConversationHistory(
  formatKind: "txt" | "json",
  contact: { id: string; name: string; phone: string },
  messages: ContactHistoryExportMessage[],
  labels: ContactHistoryExportLabels,
  dateLocale: Locale,
): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = sanitizeFilenamePart(contact.name);
  const ext = formatKind === "json" ? "json" : "txt";
  const mime = formatKind === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
  const content =
    formatKind === "json"
      ? buildContactHistoryJson(contact, messages)
      : buildContactHistoryText(contact, messages, labels, dateLocale);

  const blob = new Blob(["\uFEFF", content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `historico-${base}-${stamp}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function hasExportableContactHistory(messages: ContactHistoryExportMessage[]): boolean {
  return publicMessages(messages).length > 0;
}
