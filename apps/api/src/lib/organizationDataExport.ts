import { prisma } from "../db.js";
import type { ContactExportRow } from "./contactImportExport.js";
import { buildOrganizationExportHtml } from "./organizationExportHtml.js";
import { sendResendEmail } from "./sendResendEmail.js";

export const MAX_EXPORT_CONVERSATIONS = 50_000;
export const MAX_EXPORT_MESSAGES = 200_000;

export type OrganizationExportFormat = "json" | "csv" | "html";

export type OrganizationExportContact = ContactExportRow & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationExportConversation = {
  id: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  };
  inbox: { name: string; channelType: string } | null;
  assignedTo: { name: string; email: string } | null;
  messageCount: number;
};

export type OrganizationExportMessage = {
  id: string;
  conversationId: string;
  direction: string;
  type: string;
  body: string | null;
  mediaUrl: string | null;
  sentAt: string;
  channel: string | null;
  actorName: string | null;
  contactName: string;
  contactPhone: string;
  inboxName: string | null;
};

export type OrganizationExportData = {
  exportedAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  stats: {
    contacts: number;
    conversations: number;
    messages: number;
  };
  contacts: OrganizationExportContact[];
  conversations: OrganizationExportConversation[];
  messages: OrganizationExportMessage[];
};

export type OrganizationExportBuffer = {
  buffer: Buffer;
  contentType: string;
  extension: string;
};

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvLine(cells: string[]): string {
  return `${cells.map((c) => escapeCsvCell(c)).join(",")}\n`;
}

export async function resolveOrganizationContactEmail(
  organizationId: string,
  overrideEmail?: string | null,
): Promise<string | null> {
  const trimmed = overrideEmail?.trim();
  if (trimmed) return trimmed;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { contactEmail: true, billingEmail: true },
  });
  if (!org) return null;
  if (org.contactEmail?.trim()) return org.contactEmail.trim();
  if (org.billingEmail?.trim()) return org.billingEmail.trim();

  const admin = await prisma.user.findFirst({
    where: { organizationId, role: "ADMIN" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  return admin?.email?.trim() ?? null;
}

export async function fetchOrganizationExportData(organizationId: string): Promise<OrganizationExportData | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) return null;

  const [conversations, messages, dbContacts] = await Promise.all([
    prisma.conversation.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        contact: { select: { id: true, name: true, phone: true, email: true } },
        inbox: { select: { name: true, channelType: true } },
        assignedTo: { select: { name: true, email: true } },
        _count: { select: { messages: { where: { isPrivate: false } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_EXPORT_CONVERSATIONS,
    }),
    prisma.message.findMany({
      where: {
        isPrivate: false,
        conversation: { organizationId, deletedAt: null },
      },
      select: {
        id: true,
        conversationId: true,
        direction: true,
        type: true,
        body: true,
        mediaUrl: true,
        sentAt: true,
        channel: true,
        actorUser: { select: { name: true } },
        conversation: {
          select: {
            contact: { select: { name: true, phone: true } },
            inbox: { select: { name: true } },
          },
        },
      },
      orderBy: { sentAt: "asc" },
      take: MAX_EXPORT_MESSAGES,
    }),
    prisma.contact.findMany({
      where: { organizationId },
      include: {
        tags: { include: { tag: { select: { name: true } } } },
        account: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 50_000,
    }),
  ]);

  const contacts: OrganizationExportContact[] = dbContacts.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email ?? "",
    company: c.account?.name ?? "",
    notes: c.notes ?? "",
    tags: c.tags.map((t) => t.tag.name).join(", "),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return {
    exportedAt: new Date().toISOString(),
    organization: org,
    stats: {
      contacts: contacts.length,
      conversations: conversations.length,
      messages: messages.length,
    },
    contacts,
    conversations: conversations.map((c) => ({
      id: c.id,
      status: c.status,
      priority: c.priority ?? "",
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      contact: {
        id: c.contact.id,
        name: c.contact.name,
        phone: c.contact.phone,
        email: c.contact.email,
      },
      inbox: c.inbox ? { name: c.inbox.name, channelType: c.inbox.channelType } : null,
      assignedTo: c.assignedTo ? { name: c.assignedTo.name, email: c.assignedTo.email } : null,
      messageCount: c._count.messages,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      direction: m.direction,
      type: m.type,
      body: m.body,
      mediaUrl: m.mediaUrl,
      sentAt: m.sentAt.toISOString(),
      channel: m.channel,
      actorName: m.actorUser?.name ?? null,
      contactName: m.conversation.contact.name,
      contactPhone: m.conversation.contact.phone,
      inboxName: m.conversation.inbox?.name ?? null,
    })),
  };
}

export function buildOrganizationExportJson(data: OrganizationExportData): Buffer {
  return Buffer.from(`${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function buildOrganizationExportCsv(data: OrganizationExportData): Buffer {
  const lines: string[] = [];

  lines.push("# CONTACTS");
  lines.push(csvLine(["id", "name", "phone", "email", "company", "notes", "tags", "created_at", "updated_at"]).trimEnd());
  for (const c of data.contacts) {
    lines.push(
      csvLine([
        c.id,
        c.name,
        c.phone,
        c.email,
        c.company,
        c.notes,
        c.tags,
        c.createdAt,
        c.updatedAt,
      ]).trimEnd(),
    );
  }

  lines.push("");
  lines.push("# CONVERSATIONS");
  lines.push(
    csvLine([
      "id",
      "status",
      "priority",
      "contact_id",
      "contact_name",
      "contact_phone",
      "inbox",
      "channel",
      "assigned_to",
      "message_count",
      "created_at",
      "updated_at",
    ]).trimEnd(),
  );
  for (const c of data.conversations) {
    lines.push(
      csvLine([
        c.id,
        c.status,
        c.priority,
        c.contact.id,
        c.contact.name,
        c.contact.phone,
        c.inbox?.name ?? "",
        c.inbox?.channelType ?? "",
        c.assignedTo?.name ?? "",
        String(c.messageCount),
        c.createdAt,
        c.updatedAt,
      ]).trimEnd(),
    );
  }

  lines.push("");
  lines.push("# MESSAGES");
  lines.push(
    csvLine([
      "id",
      "conversation_id",
      "direction",
      "type",
      "body",
      "media_url",
      "channel",
      "actor_name",
      "contact_name",
      "contact_phone",
      "inbox",
      "sent_at",
    ]).trimEnd(),
  );
  for (const m of data.messages) {
    lines.push(
      csvLine([
        m.id,
        m.conversationId,
        m.direction,
        m.type,
        m.body ?? "",
        m.mediaUrl ?? "",
        m.channel ?? "",
        m.actorName ?? "",
        m.contactName,
        m.contactPhone,
        m.inboxName ?? "",
        m.sentAt,
      ]).trimEnd(),
    );
  }

  return Buffer.from(`\uFEFF${lines.join("\n")}\n`, "utf-8");
}

export async function buildOrganizationExportBuffer(
  organizationId: string,
  format: OrganizationExportFormat,
): Promise<OrganizationExportBuffer | null> {
  const data = await fetchOrganizationExportData(organizationId);
  if (!data) return null;

  if (format === "json") {
    return {
      buffer: buildOrganizationExportJson(data),
      contentType: "application/json; charset=utf-8",
      extension: "json",
    };
  }
  if (format === "csv") {
    return {
      buffer: buildOrganizationExportCsv(data),
      contentType: "text/csv; charset=utf-8",
      extension: "csv",
    };
  }
  return {
    buffer: buildOrganizationExportHtml(data),
    contentType: "text/html; charset=utf-8",
    extension: "html",
  };
}

export function buildExportFilename(slug: string, format: OrganizationExportFormat): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeSlug = slug.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-") || "org";
  return `${safeSlug}-export-${stamp}.${format}`;
}

export async function sendOrganizationExportByEmail(options: {
  organizationId: string;
  format: OrganizationExportFormat;
  email?: string | null;
}): Promise<{ ok: true; sentTo: string } | { ok: false; error: string }> {
  const toEmail = await resolveOrganizationContactEmail(options.organizationId, options.email);
  if (!toEmail) return { ok: false, error: "contact_email_missing" };

  const data = await fetchOrganizationExportData(options.organizationId);
  if (!data) return { ok: false, error: "organization_not_found" };

  const built = await buildOrganizationExportBuffer(options.organizationId, options.format);
  if (!built) return { ok: false, error: "organization_not_found" };

  const filename = buildExportFilename(data.organization.slug, options.format);
  const formatLabel = options.format.toUpperCase();
  const subject = `Exportação de dados — ${data.organization.name} (${formatLabel})`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#33475b">
      <p>Olá,</p>
      <p>Segue em anexo a exportação de contactos e conversas da organização <strong>${data.organization.name}</strong>.</p>
      <ul>
        <li><strong>Contactos:</strong> ${data.stats.contacts}</li>
        <li><strong>Conversas:</strong> ${data.stats.conversations}</li>
        <li><strong>Mensagens:</strong> ${data.stats.messages}</li>
        <li><strong>Formato:</strong> ${formatLabel}</li>
      </ul>
      <p style="color:#667781;font-size:13px">Gerado pelo OpenNexo CRM em ${new Date(data.exportedAt).toLocaleString("pt-BR")}.</p>
    </div>`;

  const result = await sendResendEmail({
    toEmail,
    subject,
    html,
    attachments: [{ filename, content: built.buffer }],
  });

  if (!result.ok) return result;
  return { ok: true, sentTo: toEmail };
}
