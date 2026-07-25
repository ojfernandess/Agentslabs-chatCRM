import { chunkText } from "./knowledgeChunking.js";

export type KnowledgeChunkOptions = {
  chunkSize?: number;
  overlap?: number;
  maxChunks?: number;
};

const HEADER_RE = /^(#{1,3})\s+(.+)$/gm;

/** Detecta documentos estruturados com secções markdown (## / ###). */
export function contentHasMarkdownSections(content: string): boolean {
  return /^#{2,3}\s+\S/m.test(content.replace(/\r\n/g, "\n"));
}

/**
 * Segmenta por secções markdown (genérico — FAQs, manuais, políticas, hotéis, produtos).
 * Secções longas são subdivididas mantendo o título como contexto.
 */
export function chunkMarkdownSections(
  content: string,
  opts: KnowledgeChunkOptions = {},
): string[] {
  const chunkSize = opts.chunkSize ?? 1500;
  const overlap = opts.overlap ?? 200;
  const maxChunks = opts.maxChunks ?? 80;
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  if (!contentHasMarkdownSections(normalized)) {
    return chunkText(normalized, chunkSize, overlap).slice(0, maxChunks);
  }

  type Section = { level: number; title: string; body: string };
  const sections: Section[] = [];
  let preamble = "";
  let current: Section | null = null;

  for (const line of normalized.split("\n")) {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, title: m[2].trim(), body: "" };
      continue;
    }
    if (current) {
      current.body += (current.body ? "\n" : "") + line;
    } else {
      preamble += (preamble ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);

  const out: string[] = [];
  if (preamble.trim()) {
    out.push(...chunkText(preamble.trim(), chunkSize, overlap));
  }

  for (const sec of sections) {
    const header = `${"#".repeat(Math.min(3, Math.max(2, sec.level)))} ${sec.title}`;
    const body = sec.body.trim();
    const full = body ? `${header}\n\n${body}` : header;
    if (full.length <= chunkSize) {
      out.push(full);
    } else {
      const sub = chunkText(body || sec.title, Math.max(400, chunkSize - header.length - 4), overlap);
      for (const piece of sub) {
        out.push(`${header}\n\n${piece}`);
      }
    }
    if (out.length >= maxChunks) break;
  }

  return out.slice(0, maxChunks);
}

/** Ponto único de chunking para indexação (markdown-first, fallback por caracteres). */
export function chunkKnowledgeDocumentContent(
  content: string,
  opts: KnowledgeChunkOptions = {},
): string[] {
  return chunkMarkdownSections(content, opts);
}
