import type { FastifyInstance } from "fastify";
import {
  ConversationPriority,
  ConversationStatus,
  MessageDirection,
  MessageType,
} from "@prisma/client";
import { normalizePhoneE164 } from "@openconduit/shared";
import { prisma } from "../db.js";
import { importContactRows, type ContactImportRow } from "./contactImportExport.js";
import { getDefaultInboxId } from "./defaultInbox.js";
import {
  MAX_EXPORT_CONVERSATIONS,
  MAX_EXPORT_MESSAGES,
  type OrganizationExportContact,
  type OrganizationExportConversation,
  type OrganizationExportMessage,
} from "./organizationDataExport.js";

export type OrganizationImportPayload = {
  contacts: OrganizationExportContact[];
  conversations: OrganizationExportConversation[];
  messages: OrganizationExportMessage[];
};

export type OrganizationImportScope = {
  importContacts: boolean;
  importConversations: boolean;
  importMessages: boolean;
  updateExistingContacts: boolean;
};

export type OrganizationImportSectionResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number | string; reason: string }[];
};

export type OrganizationImportResult = {
  format: "json" | "csv";
  contacts: OrganizationImportSectionResult;
  conversations: OrganizationImportSectionResult;
  messages: OrganizationImportSectionResult;
};

const VALID_CONV_STATUS = new Set<string>(Object.values(ConversationStatus));
const VALID_PRIORITY = new Set<string>(Object.values(ConversationPriority));
const VALID_DIRECTION = new Set<string>(Object.values(MessageDirection));
const VALID_MSG_TYPE = new Set<string>(Object.values(MessageType));

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function isHeaderRow(firstCell: string | undefined, expected: string): boolean {
  return (firstCell ?? "").trim().toLowerCase() === expected;
}

export function detectOrganizationImportFormat(filename: string, mimetype?: string): "json" | "csv" | null {
  const ext = filename.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  const mime = (mimetype ?? "").toLowerCase();
  if (ext === "json" || mime.includes("json")) return "json";
  if (ext === "csv" || mime.includes("csv")) return "csv";
  return null;
}

export function parseOrganizationImportJson(buffer: Buffer): OrganizationImportPayload {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("invalid_format");

  const obj = raw as Record<string, unknown>;
  return {
    contacts: normalizeContactsArray(obj.contacts),
    conversations: normalizeConversationsArray(obj.conversations),
    messages: normalizeMessagesArray(obj.messages),
  };
}

function normalizeContactsArray(value: unknown): OrganizationExportContact[] {
  if (!Array.isArray(value)) return [];
  const out: OrganizationExportContact[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const c = row as Record<string, unknown>;
    const phone = String(c.phone ?? "").trim();
    const name = String(c.name ?? "").trim();
    if (!phone && !name) continue;
    out.push({
      id: String(c.id ?? ""),
      name: name || phone,
      phone,
      email: String(c.email ?? ""),
      company: String(c.company ?? ""),
      notes: String(c.notes ?? ""),
      tags: String(c.tags ?? ""),
      createdAt: String(c.createdAt ?? c.created_at ?? ""),
      updatedAt: String(c.updatedAt ?? c.updated_at ?? ""),
    });
  }
  return out.slice(0, 50_000);
}

function normalizeConversationsArray(value: unknown): OrganizationExportConversation[] {
  if (!Array.isArray(value)) return [];
  const out: OrganizationExportConversation[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const c = row as Record<string, unknown>;
    const contactRaw = c.contact;
    const contact =
      contactRaw && typeof contactRaw === "object"
        ? (contactRaw as Record<string, unknown>)
        : {};
    out.push({
      id: String(c.id ?? ""),
      status: String(c.status ?? "OPEN"),
      priority: String(c.priority ?? ""),
      createdAt: String(c.createdAt ?? c.created_at ?? ""),
      updatedAt: String(c.updatedAt ?? c.updated_at ?? ""),
      contact: {
        id: String(contact.id ?? c.contact_id ?? ""),
        name: String(contact.name ?? c.contact_name ?? ""),
        phone: String(contact.phone ?? c.contact_phone ?? ""),
        email: (contact.email ?? c.contact_email ?? null) as string | null,
      },
      inbox:
        c.inbox && typeof c.inbox === "object"
          ? {
              name: String((c.inbox as Record<string, unknown>).name ?? c.inbox ?? ""),
              channelType: String((c.inbox as Record<string, unknown>).channelType ?? c.channel ?? ""),
            }
          : c.inbox || c.channel
            ? {
                name: String(c.inbox ?? ""),
                channelType: String(c.channel ?? ""),
              }
            : null,
      assignedTo:
        c.assignedTo && typeof c.assignedTo === "object"
          ? {
              name: String((c.assignedTo as Record<string, unknown>).name ?? c.assigned_to ?? ""),
              email: String((c.assignedTo as Record<string, unknown>).email ?? ""),
            }
          : c.assigned_to
            ? { name: String(c.assigned_to), email: "" }
            : null,
      messageCount: Number(c.messageCount ?? c.message_count ?? 0) || 0,
    });
  }
  return out.slice(0, MAX_EXPORT_CONVERSATIONS);
}

function normalizeMessagesArray(value: unknown): OrganizationExportMessage[] {
  if (!Array.isArray(value)) return [];
  const out: OrganizationExportMessage[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    out.push({
      id: String(m.id ?? ""),
      conversationId: String(m.conversationId ?? m.conversation_id ?? ""),
      direction: String(m.direction ?? "INBOUND"),
      type: String(m.type ?? "TEXT"),
      body: (m.body ?? null) as string | null,
      mediaUrl: (m.mediaUrl ?? m.media_url ?? null) as string | null,
      sentAt: String(m.sentAt ?? m.sent_at ?? ""),
      channel: (m.channel ?? null) as string | null,
      actorName: (m.actorName ?? m.actor_name ?? null) as string | null,
      contactName: String(m.contactName ?? m.contact_name ?? ""),
      contactPhone: String(m.contactPhone ?? m.contact_phone ?? ""),
      inboxName: (m.inboxName ?? m.inbox ?? null) as string | null,
    });
  }
  return out.slice(0, MAX_EXPORT_MESSAGES);
}

export function parseOrganizationImportCsv(buffer: Buffer): OrganizationImportPayload {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  let section: "none" | "contacts" | "conversations" | "messages" = "none";
  const contacts: OrganizationExportContact[] = [];
  const conversations: OrganizationExportConversation[] = [];
  const messages: OrganizationExportMessage[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# CONTACTS")) {
      section = "contacts";
      continue;
    }
    if (trimmed.startsWith("# CONVERSATIONS")) {
      section = "conversations";
      continue;
    }
    if (trimmed.startsWith("# MESSAGES")) {
      section = "messages";
      continue;
    }
    if (trimmed.startsWith("#")) continue;

    const cells = parseCsvLine(rawLine);

    if (section === "contacts") {
      if (isHeaderRow(cells[0], "id")) continue;
      const [id, name, phone, email, company, notes, tags, createdAt, updatedAt] = cells;
      if (!phone?.trim() && !name?.trim()) continue;
      contacts.push({
        id: id ?? "",
        name: (name ?? phone ?? "").trim(),
        phone: (phone ?? "").trim(),
        email: email ?? "",
        company: company ?? "",
        notes: notes ?? "",
        tags: tags ?? "",
        createdAt: createdAt ?? "",
        updatedAt: updatedAt ?? "",
      });
      continue;
    }

    if (section === "conversations") {
      if (isHeaderRow(cells[0], "id")) continue;
      const [
        id,
        status,
        priority,
        contactId,
        contactName,
        contactPhone,
        inboxName,
        channelType,
        assignedTo,
        _messageCount,
        createdAt,
        updatedAt,
      ] = cells;
      if (!id?.trim()) continue;
      conversations.push({
        id,
        status: status ?? "OPEN",
        priority: priority ?? "",
        createdAt: createdAt ?? "",
        updatedAt: updatedAt ?? "",
        contact: {
          id: contactId ?? "",
          name: contactName ?? "",
          phone: contactPhone ?? "",
          email: null,
        },
        inbox: inboxName || channelType ? { name: inboxName ?? "", channelType: channelType ?? "" } : null,
        assignedTo: assignedTo ? { name: assignedTo, email: "" } : null,
        messageCount: Number(_messageCount ?? 0) || 0,
      });
      continue;
    }

    if (section === "messages") {
      if (isHeaderRow(cells[0], "id")) continue;
      const [
        id,
        conversationId,
        direction,
        type,
        body,
        mediaUrl,
        channel,
        actorName,
        contactName,
        contactPhone,
        inboxName,
        sentAt,
      ] = cells;
      if (!id?.trim() || !conversationId?.trim()) continue;
      messages.push({
        id,
        conversationId,
        direction: direction ?? "INBOUND",
        type: type ?? "TEXT",
        body: body ?? null,
        mediaUrl: mediaUrl ?? null,
        sentAt: sentAt ?? "",
        channel: channel ?? null,
        actorName: actorName ?? null,
        contactName: contactName ?? "",
        contactPhone: contactPhone ?? "",
        inboxName: inboxName ?? null,
      });
    }
  }

  if (contacts.length === 0 && conversations.length === 0 && messages.length === 0) {
    throw new Error("empty_file");
  }

  return { contacts, conversations, messages };
}

export function parseOrganizationImportFile(
  buffer: Buffer,
  filename: string,
  mimetype?: string,
): { format: "json" | "csv"; payload: OrganizationImportPayload } {
  const format = detectOrganizationImportFormat(filename, mimetype);
  if (!format) throw new Error("unsupported_format");
  const payload =
    format === "json" ? parseOrganizationImportJson(buffer) : parseOrganizationImportCsv(buffer);
  if (
    payload.contacts.length === 0 &&
    payload.conversations.length === 0 &&
    payload.messages.length === 0
  ) {
    throw new Error("empty_file");
  }
  return { format, payload };
}

function parseConversationStatus(value: string | undefined): ConversationStatus {
  const normalized = (value ?? "").trim().toUpperCase();
  return VALID_CONV_STATUS.has(normalized) ? (normalized as ConversationStatus) : ConversationStatus.OPEN;
}

function parseConversationPriority(value: string | undefined): ConversationPriority | null {
  const normalized = (value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  return VALID_PRIORITY.has(normalized) ? (normalized as ConversationPriority) : null;
}

async function lookupContactByPhone(organizationId: string, phoneRaw: string): Promise<string | null> {
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) return null;
  const row = await prisma.contact.findFirst({
    where: { organizationId, phone },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function refreshContactMaps(
  organizationId: string,
  payload: OrganizationImportPayload,
): Promise<{ byExportId: Map<string, string>; byPhone: Map<string, string> }> {
  const byExportId = new Map<string, string>();
  const byPhone = new Map<string, string>();

  const phones = new Set<string>();
  for (const c of payload.contacts) {
    const phone = normalizePhoneE164(c.phone);
    if (phone) phones.add(phone);
  }
  for (const conv of payload.conversations) {
    const phone = normalizePhoneE164(conv.contact.phone);
    if (phone) phones.add(phone);
  }

  for (const phone of phones) {
    const id = await lookupContactByPhone(organizationId, phone);
    if (id) byPhone.set(phone, id);
  }

  for (const c of payload.contacts) {
    const phone = normalizePhoneE164(c.phone);
    const id = phone ? byPhone.get(phone) : null;
    if (id && c.id) byExportId.set(c.id, id);
  }

  for (const conv of payload.conversations) {
    const phone = normalizePhoneE164(conv.contact.phone);
    const id = phone ? byPhone.get(phone) : null;
    if (id && conv.contact.id) byExportId.set(conv.contact.id, id);
  }

  return { byExportId, byPhone };
}

function resolveContactId(
  conv: OrganizationExportConversation,
  maps: { byExportId: Map<string, string>; byPhone: Map<string, string> },
): string | null {
  if (conv.contact.id && maps.byExportId.has(conv.contact.id)) {
    return maps.byExportId.get(conv.contact.id) ?? null;
  }
  const phone = normalizePhoneE164(conv.contact.phone);
  if (phone && maps.byPhone.has(phone)) return maps.byPhone.get(phone) ?? null;
  return null;
}

export async function importOrganizationData(
  app: FastifyInstance,
  organizationId: string,
  payload: OrganizationImportPayload,
  scope: OrganizationImportScope,
  createdById?: string,
): Promise<Omit<OrganizationImportResult, "format">> {
  const emptySection = (): OrganizationImportSectionResult => ({
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  });

  const result = {
    contacts: emptySection(),
    conversations: emptySection(),
    messages: emptySection(),
  };

  if (scope.importContacts && payload.contacts.length > 0) {
    const rows: ContactImportRow[] = payload.contacts.map((c, index) => ({
      rowNumber: index + 1,
      name: c.name,
      phone: c.phone,
      email: c.email || null,
      company: c.company || null,
      notes: c.notes || null,
      tags: c.tags || null,
    }));
    const contactResult = await importContactRows(app, organizationId, rows, {
      updateExisting: scope.updateExistingContacts,
      createdById,
    });
    result.contacts = {
      created: contactResult.created,
      updated: contactResult.updated,
      skipped: contactResult.skipped,
      errors: contactResult.errors.map((e) => ({ row: e.row, reason: e.reason })),
    };
  }

  const contactMaps = await refreshContactMaps(organizationId, payload);
  const conversationIdByExportId = new Map<string, string>();

  const importConversations = scope.importConversations || scope.importMessages;
  if (importConversations && payload.conversations.length > 0) {
    const inboxId = await getDefaultInboxId(organizationId);
    let rowNum = 0;
    for (const conv of payload.conversations) {
      rowNum++;
      const contactId = resolveContactId(conv, contactMaps);
      if (!contactId) {
        result.conversations.skipped++;
        result.conversations.errors.push({ row: rowNum, reason: "contact_not_found" });
        continue;
      }

      try {
        const createdAt = conv.createdAt ? new Date(conv.createdAt) : undefined;
        const updatedAt = conv.updatedAt ? new Date(conv.updatedAt) : undefined;
        const created = await prisma.conversation.create({
          data: {
            organizationId,
            inboxId,
            contactId,
            status: parseConversationStatus(conv.status),
            priority: parseConversationPriority(conv.priority),
            ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
            ...(updatedAt && !Number.isNaN(updatedAt.getTime()) ? { updatedAt } : {}),
          },
        });
        if (conv.id) conversationIdByExportId.set(conv.id, created.id);
        result.conversations.created++;
      } catch {
        result.conversations.skipped++;
        result.conversations.errors.push({ row: rowNum, reason: "create_failed" });
      }
    }
  }

  if (scope.importMessages && payload.messages.length > 0) {
    let rowNum = 0;
    for (const msg of payload.messages) {
      rowNum++;
      const conversationId = conversationIdByExportId.get(msg.conversationId);
      if (!conversationId) {
        result.messages.skipped++;
        result.messages.errors.push({ row: rowNum, reason: "conversation_not_found" });
        continue;
      }

      const direction = (msg.direction ?? "").trim().toUpperCase();
      if (!VALID_DIRECTION.has(direction)) {
        result.messages.skipped++;
        result.messages.errors.push({ row: rowNum, reason: "invalid_direction" });
        continue;
      }

      const typeRaw = (msg.type ?? "TEXT").trim().toUpperCase();
      const type = VALID_MSG_TYPE.has(typeRaw) ? (typeRaw as MessageType) : MessageType.TEXT;
      const sentAt = msg.sentAt ? new Date(msg.sentAt) : new Date();

      try {
        await prisma.message.create({
          data: {
            conversationId,
            direction: direction as MessageDirection,
            type,
            body: msg.body,
            mediaUrl: msg.mediaUrl,
            channel: msg.channel,
            sentAt: Number.isNaN(sentAt.getTime()) ? new Date() : sentAt,
          },
        });
        result.messages.created++;
      } catch {
        result.messages.skipped++;
        result.messages.errors.push({ row: rowNum, reason: "create_failed" });
      }
    }
  }

  return result;
}
