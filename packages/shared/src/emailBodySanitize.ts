const QUOTE_HEADER_PATTERNS = [
  /^on .+ wrote:?$/i,
  /^em .+ escreveu:?$/i,
  /^le .+ a écrit\s*:/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*mensagem original\s*-{2,}$/i,
  /^_{5,}\s*$/,
  /^from:\s+.+/i,
];

/** Marcador no corpo armazenado: assunto\\n\\n<!--oc-email-html-->\\n<html…> */
export const EMAIL_HTML_BODY_MARKER = "<!--oc-email-html-->";

/** Corta citação inline ("… Em … escreveu:" / "… On … wrote:" na mesma linha). */
function truncateAtInlineQuoteHeader(line: string): { text: string; stop: boolean } {
  const match = line.match(/^(.+?)\s+(?:em .+ escreveu:?|on .+ wrote:?)\s*$/i);
  if (match?.[1]?.trim()) {
    return { text: match[1].trim(), stop: true };
  }
  return { text: line, stop: false };
}

/** Remove citações de resposta (>, "Em ... escreveu:", "On ... wrote:", etc.). */
export function stripEmailQuotedContent(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (QUOTE_HEADER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      break;
    }
    if (trimmed.startsWith(">")) {
      break;
    }
    const inline = truncateAtInlineQuoteHeader(line);
    if (inline.text.trim()) kept.push(inline.text);
    if (inline.stop) break;
  }

  let result = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  result = result
    .split("\n")
    .filter((line) => line.trim() !== ">")
    .join("\n")
    .trim();

  return result;
}

/**
 * Extrai o assunto do formato armazenado "assunto\\n\\ncorpo".
 * Funciona para inbound (IMAP) e outbound (após persistir o assunto no envio).
 */
export function emailSubjectFromBody(body: string | null | undefined): string | null {
  const raw = body?.replace(/\r\n/g, "\n").trim();
  if (!raw) return null;

  const parts = raw.split("\n\n");
  const first = parts[0]?.trim() ?? "";
  if (!first || first.startsWith("<") || first.startsWith("<!--")) return null;

  // Sem separador: corpo legado (outbound antigo) ou assunto sozinho.
  if (parts.length === 1) {
    if (first.includes("\n") || first.length > 200) return null;
    if (/^\((?:sem assunto|no subject)\)$/i.test(first)) return first;
    // Só confiar em prefixos de reply/forward quando não há "\n\n".
    if (/^(?:re|fw|fwd|enc|res):\s+/i.test(first)) return first;
    return null;
  }

  // Com separador: a 1.ª parte é o assunto (formato composeEmailInboundBody).
  if (first.includes("\n") || first.length > 998) return null;
  return first;
}

/** Extrai corpo (após assunto) do formato armazenado "assunto\\n\\ncorpo". */
export function emailStoredContent(body: string | null | undefined): string {
  const raw = body?.replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const subject = emailSubjectFromBody(raw);
  if (!subject) return raw;

  const subjectSplit = raw.split("\n\n");
  if (subjectSplit.length >= 2 && subjectSplit[0]?.trim()) {
    return subjectSplit.slice(1).join("\n\n").trim();
  }
  // Assunto sozinho (sem corpo).
  return "";
}

export function isEmailHtmlStoredContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith(EMAIL_HTML_BODY_MARKER)) return true;
  return /<(?:html|body|div|table|p|a|img|span|br)\b/i.test(trimmed);
}

export function emailHtmlFromStoredContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(EMAIL_HTML_BODY_MARKER)) {
    return trimmed.slice(EMAIL_HTML_BODY_MARKER.length).trim() || null;
  }
  if (isEmailHtmlStoredContent(trimmed)) return trimmed;
  return null;
}

/** Extrai corpo exibível a partir do formato armazenado "assunto\\n\\ncorpo". */
export function emailMessageDisplayBody(body: string | null | undefined): string {
  const content = emailStoredContent(body);
  if (!content) return "";

  const html = emailHtmlFromStoredContent(content);
  if (html) return html;

  return stripEmailQuotedContent(content);
}

export function htmlToPlainTextForEmail(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "center",
  "code",
  "col",
  "colgroup",
  "div",
  "em",
  "figcaption",
  "figure",
  "font",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const GLOBAL_ATTRS = new Set(["align", "class", "dir", "id", "lang", "style", "title"]);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "name", "rel", "target"]),
  img: new Set(["alt", "height", "src", "width", "border", "align", "hspace", "vspace"]),
  td: new Set(["colspan", "rowspan", "valign", "width", "bgcolor", "height", "background", "align"]),
  th: new Set(["colspan", "rowspan", "valign", "width", "bgcolor", "height", "background", "align"]),
  table: new Set(["border", "cellpadding", "cellspacing", "width", "bgcolor", "role", "align", "background"]),
  tr: new Set(["align", "valign", "bgcolor", "height"]),
  div: new Set(["align", "bgcolor"]),
  p: new Set(["align"]),
  span: new Set(["align"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span", "width"]),
  font: new Set(["color", "face", "size"]),
  hr: new Set(["size", "width", "noshade"]),
};

function isSafeUrl(value: string, allowDataImage = false): boolean {
  const v = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!v) return false;
  if (v.startsWith("#")) return true;
  if (v.startsWith("mailto:") || v.startsWith("tel:")) return true;
  if (/^https?:\/\//i.test(v)) return true;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) return true;
  // CID resolvido para URL local da API
  if (v.startsWith("/api/v1/messages/media/")) return true;
  return false;
}

function sanitizeStyle(value: string): string {
  return value
    .replace(/expression\s*\(/gi, "")
    .replace(/url\s*\(\s*['"]?\s*javascript:/gi, "url(")
    .replace(/-moz-binding/gi, "")
    .replace(/behavior\s*:/gi, "")
    .slice(0, 8000);
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  const allowed = new Set([...(TAG_ATTRS[tag] ?? []), ...GLOBAL_ATTRS]);
  const out: string[] = [];
  const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(rawAttrs))) {
    const name = match[1].toLowerCase();
    if (name.startsWith("on") || name === "srcset" || name === "xlink:href") continue;
    if (!allowed.has(name)) continue;
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (name === "href" || name === "src" || name === "background") {
      if (!isSafeUrl(value, name === "src")) continue;
      out.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
      continue;
    }
    if (name === "style") {
      out.push(`style="${sanitizeStyle(value).replace(/"/g, "&quot;")}"`);
      continue;
    }
    if (name === "target") {
      out.push(`target="_blank"`);
      continue;
    }
    if (name === "rel") {
      out.push(`rel="noopener noreferrer"`);
      continue;
    }
    out.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
  }
  if (tag === "a") {
    if (!out.some((a) => a.startsWith("rel="))) out.push(`rel="noopener noreferrer"`);
    if (!out.some((a) => a.startsWith("target="))) out.push(`target="_blank"`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/**
 * Sanitiza HTML de e-mail para armazenamento/exibição segura.
 * Mantém <style> (necessário para layouts tipo Instagram) e remove scripts/handlers.
 */
export function sanitizeEmailHtml(html: string): string {
  const styleBlocks: string[] = [];
  let input = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_full, css: string) => {
    const cleaned = css
      .replace(/@import\b[^;]*;?/gi, "")
      .replace(/expression\s*\(/gi, "")
      .replace(/behavior\s*:/gi, "")
      .replace(/-moz-binding/gi, "")
      .replace(/javascript\s*:/gi, "")
      .slice(0, 80_000);
    const idx = styleBlocks.length;
    styleBlocks.push(cleaned);
    return `<!--oc-style-${idx}-->`;
  });

  input = input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--(?!oc-(?:email-html|style-\d+))[\s\S]*?-->/g, "")
    .replace(/<\/?(?:html|head|body|meta|link|base|iframe|object|embed|form|input|button|textarea|select|option|svg|math)[^>]*>/gi, "");

  input = input.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (full, rawTag: string, rawAttrs = "") => {
    const tag = rawTag.toLowerCase();
    const closing = full.startsWith("</");
    const selfClosing = /\/>\s*$/.test(full) || tag === "br" || tag === "hr" || tag === "img" || tag === "col";
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (closing) return `</${tag}>`;
    const attrs = sanitizeAttributes(tag, rawAttrs || "");
    return selfClosing ? `<${tag}${attrs} />` : `<${tag}${attrs}>`;
  });

  input = input.replace(/<!--oc-style-(\d+)-->/g, (_full, idx: string) => {
    const css = styleBlocks[Number(idx)];
    return css ? `<style type="text/css">${css}</style>` : "";
  });

  return input.trim();
}

/**
 * Monta corpo armazenado de e-mail: assunto + texto ou HTML marcado.
 * Usado em inbound (IMAP) e outbound (SMTP) para manter o título recuperável.
 */
export function composeEmailInboundBody(
  subject: string | undefined,
  content: string | undefined,
  options?: { html?: boolean; stripQuotes?: boolean },
): string {
  const subj = subject?.trim() || "(Sem assunto)";
  const raw = content?.trim() || "";
  if (!raw) return `${subj}\n\n`;
  if (options?.html) {
    const sanitized = sanitizeEmailHtml(raw);
    if (!sanitized) return `${subj}\n\n`;
    return `${subj}\n\n${EMAIL_HTML_BODY_MARKER}\n${sanitized}`;
  }
  const stripQuotes = options?.stripQuotes !== false;
  const cleaned = stripQuotes ? stripEmailQuotedContent(raw) : raw;
  return cleaned ? `${subj}\n\n${cleaned}` : `${subj}\n\n`;
}
