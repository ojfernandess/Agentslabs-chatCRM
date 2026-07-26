import { chunkText } from "./knowledgeChunking.js";
import { extractQueryTopicTerms } from "./knowledgeQueryEnrichment.js";

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

  const logical = aggregateH2WithChildH3Sections(
    sections.map((s) => ({ level: s.level, title: s.title, body: s.body })),
  );

  const out: string[] = [];
  if (preamble.trim()) {
    out.push(...chunkText(preamble.trim(), chunkSize, overlap));
  }

  for (const sec of logical) {
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

/** Texto útil além de cabeçalhos markdown. */
export function hasSubstantiveChunkBody(text: string, minBodyChars = 30): boolean {
  const body = text
    .replace(/^#{1,6}\s+.+$/gm, "")
    .replace(/^---+$/gm, "")
    .trim();
  return body.length >= minBodyChars;
}

type ParsedMarkdownSection = { level: number; title: string; body: string };

function parseMarkdownSectionsForExtraction(normalized: string): ParsedMarkdownSection[] {
  const sections: ParsedMarkdownSection[] = [];
  let current: ParsedMarkdownSection | null = null;

  for (const line of normalized.split("\n")) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, title: m[2].trim(), body: "" };
      continue;
    }
    if (current) current.body += (current.body ? "\n" : "") + line;
  }
  if (current) sections.push(current);
  return sections;
}

/** Junta ### filhos imediatos ao ## pai (ex.: catálogo de quartos com subsecções por suíte). */
export function aggregateH2WithChildH3Sections(sections: ParsedMarkdownSection[]): ParsedMarkdownSection[] {
  const logical: ParsedMarkdownSection[] = [];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.level !== 2) {
      logical.push(sec);
      continue;
    }

    const childBlocks: string[] = [];
    let j = i + 1;
    while (j < sections.length && sections[j].level === 3) {
      const child = sections[j];
      childBlocks.push(`### ${child.title}\n${child.body.trim()}`.trim());
      j++;
    }

    if (childBlocks.length > 0) {
      const parentBody = sec.body.trim();
      logical.push({
        level: 2,
        title: sec.title,
        body: [parentBody, ...childBlocks].filter(Boolean).join("\n\n"),
      });
      i = j - 1;
    } else {
      logical.push(sec);
    }
  }

  return logical;
}

function truncateMarkdownSection(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSub = cut.lastIndexOf("\n### ");
  if (lastSub > maxLen * 0.35) {
    return `${cut.slice(0, lastSub).trimEnd()}…`;
  }
  return `${cut.trimEnd()}…`;
}

/** Extrai secção markdown cujo título corresponde aos termos da query. */
export function extractMarkdownSectionForQuery(content: string, query: string, maxLen = 1200): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const terms = extractQueryTopicTerms(query);
  if (!terms.length) return normalized.slice(0, maxLen);

  const sections = aggregateH2WithChildH3Sections(parseMarkdownSectionsForExtraction(normalized));

  let best: ParsedMarkdownSection | null = null;
  let bestScore = 0;
  for (const sec of sections) {
    const titleLower = sec.title.toLowerCase();
    const bodyLower = sec.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const t = term.toLowerCase();
      if (titleLower.includes(t) || t.includes(titleLower.split("/")[0]?.trim() ?? "")) score += 3;
      else if (bodyLower.includes(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sec;
    }
  }
  if (!best || bestScore === 0) return normalized.slice(0, maxLen);

  const childCount = (best.body.match(/^###\s+/gm) ?? []).length;
  const effectiveMaxLen = childCount >= 2 ? Math.max(maxLen, 3200) : maxLen;

  const header = `## ${best.title}`;
  const full = best.body.trim() ? `${header}\n\n${best.body.trim()}` : header;
  return truncateMarkdownSection(full, effectiveMaxLen);
}
