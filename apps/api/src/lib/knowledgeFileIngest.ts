import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const MAX_TEXT_CHARS = 1_200_000;
const MAX_PDF_PAGES = 200;

export type KnowledgeIngestResult = {
  text: string;
  mimeType: string;
};

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function titleFromFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim() || "document";
  return stem.slice(0, 500);
}

function capText(raw: string): string {
  const t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (t.length <= MAX_TEXT_CHARS) return t;
  return `${t.slice(0, MAX_TEXT_CHARS)}\n\n… [truncated]`;
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ first: MAX_PDF_PAGES });
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const r = await mammoth.extractRawText({ buffer });
  return r.value ?? "";
}

function extractPlain(buffer: Buffer): string {
  try {
    return buffer.toString("utf8");
  } catch {
    return buffer.toString("latin1");
  }
}

function extractXlsx(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) parts.push(`## ${name}\n${csv}`);
  }
  return parts.join("\n\n");
}

/**
 * Extrai texto para a KB a partir de PDF, DOCX, TXT/MD/CSV ou XLSX.
 */
export async function extractKnowledgeFileText(params: {
  buffer: Buffer;
  filename: string;
  mimetype?: string;
}): Promise<KnowledgeIngestResult> {
  const ext = extensionOf(params.filename);
  const mime = (params.mimetype ?? "").toLowerCase();

  let text: string;
  let mimeType: string;

  if (ext === "pdf" || mime === "application/pdf") {
    text = await extractPdf(params.buffer);
    mimeType = "application/pdf";
  } else if (ext === "docx" || mime.includes("wordprocessingml") || mime.includes("officedocument.wordprocessingml")) {
    text = await extractDocx(params.buffer);
    mimeType =
      mime && mime !== "application/octet-stream"
        ? mime
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") {
    text = extractXlsx(params.buffer);
    mimeType = mime && mime !== "application/octet-stream" ? mime : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (
    ext === "txt" ||
    ext === "md" ||
    ext === "markdown" ||
    ext === "csv" ||
    ext === "tsv" ||
    mime.startsWith("text/") ||
    mime === "application/csv"
  ) {
    text = extractPlain(params.buffer);
    mimeType = mime || "text/plain";
  } else {
    throw new KnowledgeIngestError("unsupported_type", `Unsupported file type (.${ext || "?"})`);
  }

  const capped = capText(text);
  if (!capped.trim()) {
    throw new KnowledgeIngestError("empty", "No extractable text in file");
  }

  return { text: capped, mimeType };
}

export class KnowledgeIngestError extends Error {
  constructor(
    public readonly code: "unsupported_type" | "empty" | "parse_failed",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeIngestError";
  }
}

export function wrapIngestError(err: unknown): KnowledgeIngestError {
  if (err instanceof KnowledgeIngestError) return err;
  const msg = err instanceof Error ? err.message : "parse_failed";
  return new KnowledgeIngestError("parse_failed", msg.slice(0, 800));
}
