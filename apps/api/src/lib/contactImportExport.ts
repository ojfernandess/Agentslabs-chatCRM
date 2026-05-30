import type { FastifyInstance } from "fastify";
import * as XLSX from "xlsx";
import { normalizePhoneE164 } from "@openconduit/shared";
import { prisma } from "../db.js";
import { fireBroadcastEventTriggers } from "./broadcastEventHooks.js";

export const MAX_CONTACT_IMPORT_ROWS = 5000;
export const MAX_CONTACT_EXPORT_ROWS = 50_000;

export type ContactExportRow = {
  name: string;
  phone: string;
  email: string;
  company: string;
  notes: string;
  tags: string;
};

export type ContactImportRow = {
  name: string;
  phone: string;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  tags?: string | null;
  rowNumber: number;
};

export type ContactImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
};

const EXPORT_HEADERS: (keyof ContactExportRow)[] = ["name", "phone", "email", "company", "notes", "tags"];

const HEADER_ALIASES: Record<string, keyof Omit<ContactImportRow, "rowNumber">> = {
  name: "name",
  nome: "name",
  "full name": "name",
  phone: "phone",
  telefone: "phone",
  tel: "phone",
  mobile: "phone",
  celular: "phone",
  whatsapp: "phone",
  email: "email",
  "e-mail": "email",
  mail: "email",
  company: "company",
  empresa: "company",
  organization: "company",
  org: "company",
  notes: "notes",
  note: "notes",
  notas: "notes",
  observacoes: "notes",
  observations: "notes",
  tags: "tags",
  tag: "tags",
  etiquetas: "tags",
};

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapHeaders(headers: string[]): Map<number, keyof Omit<ContactImportRow, "rowNumber">> {
  const map = new Map<number, keyof Omit<ContactImportRow, "rowNumber">>();
  headers.forEach((h, i) => {
    const key = HEADER_ALIASES[normalizeHeader(h)];
    if (key) map.set(i, key);
  });
  return map;
}

function rowFromMappedCells(
  cells: string[],
  columnMap: Map<number, keyof Omit<ContactImportRow, "rowNumber">>,
  rowNumber: number,
): ContactImportRow | null {
  const partial: Partial<Omit<ContactImportRow, "rowNumber">> = {};
  columnMap.forEach((field, colIdx) => {
    const v = (cells[colIdx] ?? "").trim();
    if (v) partial[field] = v;
  });
  if (!partial.phone && !partial.name && !partial.email && !partial.company && !partial.notes && !partial.tags) {
    return null;
  }
  return {
    rowNumber,
    name: (partial.name ?? "").trim(),
    phone: (partial.phone ?? "").trim(),
    email: partial.email ?? null,
    company: partial.company ?? null,
    notes: partial.notes ?? null,
    tags: partial.tags ?? null,
  };
}

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

export function parseContactsCsv(buffer: Buffer): ContactImportRow[] {
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  const headerCells = parseCsvLine(lines[0]);
  const columnMap = mapHeaders(headerCells);
  const hasPhoneCol = [...columnMap.values()].includes("phone");
  const hasNameCol = [...columnMap.values()].includes("name");

  const rows: ContactImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (columnMap.size > 0 && (hasPhoneCol || hasNameCol)) {
      const row = rowFromMappedCells(cells, columnMap, i + 1);
      if (row) rows.push(row);
    } else {
      const [name = "", phone = "", email = "", company = "", notes = "", tags = ""] = cells;
      if (!name.trim() && !phone.trim()) continue;
      rows.push({
        rowNumber: i + 1,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        company: company.trim() || null,
        notes: notes.trim() || null,
        tags: tags.trim() || null,
      });
    }
  }
  return rows.slice(0, MAX_CONTACT_IMPORT_ROWS);
}

export function parseContactsXlsx(buffer: Buffer): ContactImportRow[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false }) as string[][];
  if (matrix.length === 0) return [];

  const headerRow = (matrix[0] ?? []).map((c) => String(c ?? ""));
  const columnMap = mapHeaders(headerRow);
  const hasMappedCols = columnMap.size > 0;

  const rows: ContactImportRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = (matrix[i] ?? []).map((c) => String(c ?? "").trim());
    if (hasMappedCols) {
      const row = rowFromMappedCells(cells, columnMap, i + 1);
      if (row) rows.push(row);
    } else {
      const [name = "", phone = "", email = "", company = "", notes = "", tags = ""] = cells;
      if (!name && !phone) continue;
      rows.push({
        rowNumber: i + 1,
        name,
        phone,
        email: email || null,
        company: company || null,
        notes: notes || null,
        tags: tags || null,
      });
    }
  }
  return rows.slice(0, MAX_CONTACT_IMPORT_ROWS);
}

function unfoldVcardLines(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce<string[]>((acc, line) => {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        if (acc.length > 0) acc[acc.length - 1] += line.slice(1);
        else acc.push(line.trimStart());
      } else {
        acc.push(line);
      }
      return acc;
    }, [])
    .join("\n");
}

function vcardFieldValue(line: string): string {
  const idx = line.indexOf(":");
  if (idx < 0) return "";
  let value = line.slice(idx + 1).trim();
  if (value.startsWith("=")) value = value.slice(1);
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

function parseVcardBlock(block: string, index: number): ContactImportRow | null {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  let name = "";
  let phone = "";
  let email: string | null = null;
  let company: string | null = null;
  let notes: string | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("FN")) {
      name = vcardFieldValue(line);
    } else if (upper.startsWith("N") && !upper.startsWith("NOTE") && !name) {
      const parts = vcardFieldValue(line).split(";");
      name = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
    } else if (upper.startsWith("TEL")) {
      const tel = vcardFieldValue(line);
      if (tel && !phone) phone = tel;
    } else if (upper.startsWith("EMAIL")) {
      const em = vcardFieldValue(line);
      if (em && !email) email = em;
    } else if (upper.startsWith("ORG")) {
      const org = vcardFieldValue(line).replace(/;/g, " ").trim();
      if (org) company = org;
    } else if (upper.startsWith("NOTE")) {
      const note = vcardFieldValue(line);
      if (note) notes = note;
    }
  }

  if (!phone && !name && !email) return null;
  return {
    rowNumber: index,
    name: name || phone || email || "Contato",
    phone,
    email,
    company,
    notes,
    tags: null,
  };
}

export function parseContactsVcf(buffer: Buffer): ContactImportRow[] {
  const text = unfoldVcardLines(buffer.toString("utf8"));
  const blocks = text.split(/BEGIN:VCARD/i).slice(1);
  const rows: ContactImportRow[] = [];
  blocks.forEach((block, i) => {
    const row = parseVcardBlock(block, i + 1);
    if (row) rows.push(row);
  });
  return rows.slice(0, MAX_CONTACT_IMPORT_ROWS);
}

export function detectContactImportFormat(filename: string, mimetype?: string): "csv" | "xlsx" | "vcf" | null {
  const ext = filename.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  const mime = (mimetype ?? "").toLowerCase();
  if (ext === "csv" || mime.includes("csv")) return "csv";
  if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) return "xlsx";
  if (ext === "vcf" || ext === "vcard" || mime.includes("vcard")) return "vcf";
  return null;
}

export function parseContactImportFile(
  buffer: Buffer,
  filename: string,
  mimetype?: string,
): { format: "csv" | "xlsx" | "vcf"; rows: ContactImportRow[] } {
  const format = detectContactImportFormat(filename, mimetype);
  if (!format) throw new Error("unsupported_format");
  let rows: ContactImportRow[];
  if (format === "csv") rows = parseContactsCsv(buffer);
  else if (format === "xlsx") rows = parseContactsXlsx(buffer);
  else rows = parseContactsVcf(buffer);
  if (rows.length === 0) throw new Error("empty_file");
  return { format, rows };
}

export function buildContactsCsv(rows: ContactExportRow[]): Buffer {
  const header = EXPORT_HEADERS.join(",");
  const body = rows.map((r) =>
    EXPORT_HEADERS.map((h) => escapeCsvCell(r[h] ?? "")).join(","),
  );
  return Buffer.from(`\uFEFF${header}\n${body.join("\n")}`, "utf8");
}

export function buildContactsXlsx(rows: ContactExportRow[]): Buffer {
  const data = [EXPORT_HEADERS, ...rows.map((r) => EXPORT_HEADERS.map((h) => r[h] ?? ""))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function escapeVcardValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function buildContactsVcf(rows: ContactExportRow[]): Buffer {
  const cards = rows.map((r) => {
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcardValue(r.name)}`, `N:;${escapeVcardValue(r.name)};;;`];
    if (r.phone) lines.push(`TEL;TYPE=CELL:${escapeVcardValue(r.phone)}`);
    if (r.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcardValue(r.email)}`);
    if (r.company) lines.push(`ORG:${escapeVcardValue(r.company)}`);
    if (r.notes) lines.push(`NOTE:${escapeVcardValue(r.notes)}`);
    lines.push("END:VCARD");
    return lines.join("\r\n");
  });
  return Buffer.from(cards.join("\r\n"), "utf8");
}

async function findOrCreateAccountByName(organizationId: string, name: string): Promise<string> {
  const trimmed = name.trim().slice(0, 255);
  const existing = await prisma.account.findFirst({
    where: { organizationId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing.id;
  const created = await prisma.account.create({ data: { organizationId, name: trimmed } });
  return created.id;
}

function splitTagNames(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))].slice(0, 20);
}

async function resolveTagIds(organizationId: string, tagNames: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of tagNames) {
    const trimmed = name.slice(0, 100);
    let tag = await prisma.tag.findFirst({
      where: { organizationId, name: { equals: trimmed, mode: "insensitive" } },
    });
    if (!tag) {
      tag = await prisma.tag.create({
        data: { organizationId, name: trimmed, color: "#6366f1" },
      });
    }
    ids.push(tag.id);
  }
  return ids;
}

export async function importContactRows(
  app: FastifyInstance,
  organizationId: string,
  rows: ContactImportRow[],
  options: { updateExisting: boolean; createdById?: string },
): Promise<ContactImportResult> {
  const result: ContactImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const row of rows) {
    const phone = normalizePhoneE164(row.phone);
    if (!phone) {
      result.skipped++;
      result.errors.push({ row: row.rowNumber, reason: "invalid_phone" });
      continue;
    }

    const name = (row.name?.trim() || phone).slice(0, 255);
    const email = row.email?.trim().slice(0, 255) || null;
    const notes = row.notes?.trim().slice(0, 5000) || null;
    const company = row.company?.trim().slice(0, 255) || null;
    const tagNames = splitTagNames(row.tags);

    const existing = await prisma.contact.findFirst({
      where: { organizationId, phone },
      select: { id: true, accountId: true },
    });

    if (existing) {
      if (!options.updateExisting) {
        result.skipped++;
        result.errors.push({ row: row.rowNumber, reason: "duplicate" });
        continue;
      }

      const data: Record<string, unknown> = { name };
      if (email) data.email = email;
      if (notes) data.notes = notes;
      if (company) {
        data.accountId = await findOrCreateAccountByName(organizationId, company);
      }

      await prisma.contact.update({ where: { id: existing.id }, data });

      if (tagNames.length > 0) {
        const tagIds = await resolveTagIds(organizationId, tagNames);
        for (const tagId of tagIds) {
          await prisma.contactTag.upsert({
            where: { contactId_tagId: { contactId: existing.id, tagId } },
            create: { contactId: existing.id, tagId },
            update: {},
          });
        }
      }

      result.updated++;
      continue;
    }

    let accountId: string | undefined;
    if (company) {
      accountId = await findOrCreateAccountByName(organizationId, company);
    }

    const tagIds = tagNames.length > 0 ? await resolveTagIds(organizationId, tagNames) : [];

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name,
        email,
        notes,
        accountId,
        createdById: options.createdById,
        tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
    });

    fireBroadcastEventTriggers(app, organizationId, "NEW_LEAD", { contactId: contact.id });
    result.created++;
  }

  return result;
}

export type ContactExportQuery = {
  organizationId: string;
  search?: string;
};

export async function fetchContactsForExport(query: ContactExportQuery): Promise<ContactExportRow[]> {
  const where: Record<string, unknown> = { organizationId: query.organizationId };
  if (query.search?.trim()) {
    const q = query.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
      { account: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const contacts = await prisma.contact.findMany({
    where,
    include: {
      tags: { include: { tag: { select: { name: true } } } },
      account: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CONTACT_EXPORT_ROWS,
  });

  return contacts.map((c) => ({
    name: c.name,
    phone: c.phone,
    email: c.email ?? "",
    company: c.account?.name ?? "",
    notes: c.notes ?? "",
    tags: c.tags.map((t) => t.tag.name).join(", "),
  }));
}
