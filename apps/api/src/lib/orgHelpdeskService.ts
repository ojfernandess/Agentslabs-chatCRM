import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { prisma } from "../db.js";
import { putMessageMediaFile } from "./mediaStorage.js";

export const HELPDESK_CATEGORIES = [
  "IMPORT_DATA",
  "EXPORT_DATA",
  "IMPLEMENTATION",
  "GENERAL",
] as const;

export const HELPDESK_STATUSES = [
  "OPEN",
  "ACCEPTED",
  "IN_PROGRESS",
  "WAITING_ORG",
  "RESOLVED",
  "CLOSED",
] as const;

export type HelpdeskCategory = (typeof HELPDESK_CATEGORIES)[number];
export type HelpdeskStatus = (typeof HELPDESK_STATUSES)[number];

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

export function isHelpdeskCategory(value: string): value is HelpdeskCategory {
  return (HELPDESK_CATEGORIES as readonly string[]).includes(value);
}

export function isHelpdeskStatus(value: string): value is HelpdeskStatus {
  return (HELPDESK_STATUSES as readonly string[]).includes(value);
}

type AttachmentRow = {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: Date;
};

type MessageRow = {
  id: string;
  body: string;
  isStaffReply: boolean;
  createdAt: Date;
  author: { id: string; name: string; email: string };
  attachments: AttachmentRow[];
};

const requestInclude = {
  organization: { select: { id: true, name: true, slug: true, contactEmail: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
  acceptedBy: { select: { id: true, name: true, email: true } },
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: {
      authorUser: { select: { id: true, name: true, email: true } },
      attachments: {
        orderBy: { createdAt: "asc" as const },
        select: {
          id: true,
          filename: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          url: true,
          createdAt: true,
        },
      },
    },
  },
  attachments: {
    where: { messageId: null },
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      url: true,
      createdAt: true,
    },
  },
};

function mapAttachment(row: {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: Date;
}): AttachmentRow {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: row.url,
    createdAt: row.createdAt,
  };
}

function mapMessage(row: {
  id: string;
  body: string;
  isStaffReply: boolean;
  createdAt: Date;
  authorUser: { id: string; name: string; email: string };
  attachments: Array<{
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
    createdAt: Date;
  }>;
}): MessageRow {
  return {
    id: row.id,
    body: row.body,
    isStaffReply: row.isStaffReply,
    createdAt: row.createdAt,
    author: row.authorUser,
    attachments: row.attachments.map(mapAttachment),
  };
}

export function serializeHelpdeskRequest(row: Awaited<ReturnType<typeof fetchHelpdeskRequestById>>) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    organization: row.organization,
    category: row.category,
    subject: row.subject,
    description: row.description,
    status: row.status,
    progressNote: row.progressNote,
    progressPercent: row.progressPercent,
    createdBy: row.createdBy,
    assignedTo: row.assignedTo,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: row.attachments.map(mapAttachment),
    messages: row.messages.map(mapMessage),
  };
}

export function serializeHelpdeskRequestSummary(row: {
  id: string;
  organizationId: string;
  category: string;
  subject: string;
  status: string;
  progressPercent: number | null;
  createdAt: Date;
  updatedAt: Date;
  organization?: { id: string; name: string; slug: string };
  createdBy: { id: string; name: string; email: string };
  _count?: { messages: number; attachments: number };
}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    organization: row.organization ?? null,
    category: row.category,
    subject: row.subject,
    status: row.status,
    progressPercent: row.progressPercent,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    messageCount: row._count?.messages ?? 0,
    attachmentCount: row._count?.attachments ?? 0,
  };
}

export async function fetchHelpdeskRequestById(id: string) {
  return prisma.orgHelpdeskRequest.findUnique({
    where: { id },
    include: requestInclude,
  });
}

export async function listOrgHelpdeskRequests(organizationId: string) {
  const rows = await prisma.orgHelpdeskRequest.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { messages: true, attachments: true } },
    },
  });
  return rows.map(serializeHelpdeskRequestSummary);
}

export async function listAllHelpdeskRequests(filters?: { status?: string; organizationId?: string }) {
  const rows = await prisma.orgHelpdeskRequest.findMany({
    where: {
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.organizationId ? { organizationId: filters.organizationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { messages: true, attachments: true } },
    },
  });
  return rows.map(serializeHelpdeskRequestSummary);
}

function safeStorageFilename(originalName: string, mimeType: string): string {
  const ext = extname(originalName).slice(0, 12) || guessExt(mimeType);
  return `helpdesk-${randomUUID()}${ext}`;
}

function guessExt(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "text/csv") return ".csv";
  if (mimeType === "application/json") return ".json";
  return ".bin";
}

export type ParsedHelpdeskMultipart = {
  fields: Record<string, string>;
  files: Array<{ buffer: Buffer; filename: string; mimetype: string }>;
};

export async function parseHelpdeskMultipart(parts: AsyncIterable<MultipartFile | { type: "field"; fieldname: string; value: unknown }>): Promise<ParsedHelpdeskMultipart> {
  const fields: Record<string, string> = {};
  const files: ParsedHelpdeskMultipart["files"] = [];

  for await (const part of parts) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (!buffer.length) continue;
      files.push({
        buffer,
        filename: part.filename || "attachment",
        mimetype: part.mimetype || "application/octet-stream",
      });
      continue;
    }
    fields[part.fieldname] = String(part.value ?? "");
  }

  return { fields, files };
}

async function storeHelpdeskAttachments(input: {
  requestId: string;
  messageId?: string | null;
  uploadedById: string;
  files: ParsedHelpdeskMultipart["files"];
}) {
  const stored: AttachmentRow[] = [];
  for (const file of input.files.slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) continue;
    const mimeType = file.mimetype.split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) continue;

    const filename = safeStorageFilename(file.filename, mimeType);
    const { mediaUrl } = await putMessageMediaFile({
      filename,
      buffer: file.buffer,
      contentType: mimeType,
    });

    const row = await prisma.orgHelpdeskAttachment.create({
      data: {
        requestId: input.requestId,
        messageId: input.messageId ?? null,
        filename,
        originalName: file.filename.slice(0, 255),
        mimeType,
        sizeBytes: file.buffer.length,
        url: mediaUrl,
        uploadedById: input.uploadedById,
      },
    });
    stored.push(mapAttachment(row));
  }
  return stored;
}

export async function createHelpdeskRequest(input: {
  organizationId: string;
  createdById: string;
  category: HelpdeskCategory;
  subject: string;
  description: string;
  files?: ParsedHelpdeskMultipart["files"];
}) {
  const request = await prisma.orgHelpdeskRequest.create({
    data: {
      organizationId: input.organizationId,
      category: input.category,
      subject: input.subject.trim().slice(0, 500),
      description: input.description.trim(),
      createdById: input.createdById,
    },
  });

  if (input.files?.length) {
    await storeHelpdeskAttachments({
      requestId: request.id,
      uploadedById: input.createdById,
      files: input.files,
    });
  }

  return serializeHelpdeskRequest(await fetchHelpdeskRequestById(request.id));
}

export async function addHelpdeskMessage(input: {
  requestId: string;
  authorUserId: string;
  body: string;
  isStaffReply: boolean;
  files?: ParsedHelpdeskMultipart["files"];
}) {
  const request = await prisma.orgHelpdeskRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true },
  });
  if (!request) return null;
  if (request.status === "CLOSED") return null;

  const message = await prisma.orgHelpdeskMessage.create({
    data: {
      requestId: input.requestId,
      authorUserId: input.authorUserId,
      body: input.body.trim(),
      isStaffReply: input.isStaffReply,
    },
  });

  if (input.files?.length) {
    await storeHelpdeskAttachments({
      requestId: input.requestId,
      messageId: message.id,
      uploadedById: input.authorUserId,
      files: input.files,
    });
  }

  const nextStatus = input.isStaffReply
    ? request.status === "OPEN" || request.status === "ACCEPTED"
      ? "IN_PROGRESS"
      : request.status
    : "WAITING_ORG";

  await prisma.orgHelpdeskRequest.update({
    where: { id: input.requestId },
    data: {
      status: nextStatus,
      updatedAt: new Date(),
    },
  });

  return serializeHelpdeskRequest(await fetchHelpdeskRequestById(input.requestId));
}

export async function updateHelpdeskRequest(input: {
  requestId: string;
  actorUserId: string;
  status?: HelpdeskStatus;
  progressNote?: string | null;
  progressPercent?: number | null;
  accept?: boolean;
}) {
  const existing = await prisma.orgHelpdeskRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true, acceptedAt: true },
  });
  if (!existing) return null;

  const data: Record<string, unknown> = { updatedAt: new Date() };

  if (input.accept) {
    data.status = "ACCEPTED";
    data.acceptedAt = new Date();
    data.acceptedById = input.actorUserId;
    data.assignedToId = input.actorUserId;
  }

  if (input.status && isHelpdeskStatus(input.status)) {
    data.status = input.status;
    if (input.status === "RESOLVED" || input.status === "CLOSED") {
      data.resolvedAt = new Date();
    }
    if (input.status === "IN_PROGRESS" && !existing.acceptedAt) {
      data.acceptedAt = new Date();
      data.acceptedById = input.actorUserId;
      data.assignedToId = input.actorUserId;
    }
  }

  if (input.progressNote !== undefined) {
    data.progressNote = input.progressNote?.trim() ? input.progressNote.trim().slice(0, 5000) : null;
  }

  if (input.progressPercent !== undefined) {
    const pct =
      input.progressPercent == null ? null : Math.max(0, Math.min(100, Math.round(input.progressPercent)));
    data.progressPercent = pct;
  }

  await prisma.orgHelpdeskRequest.update({
    where: { id: input.requestId },
    data,
  });

  return serializeHelpdeskRequest(await fetchHelpdeskRequestById(input.requestId));
}
