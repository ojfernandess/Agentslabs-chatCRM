/** Extracção simples de texto a partir de HTML (páginas web como fonte KB). */
export function htmlToPlainText(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<\/(p|div|section|article|header|footer|br|h[1-6]|li|tr|blockquote)>/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  return t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  const raw = htmlToPlainText(m[1]).replace(/\s+/g, " ").trim();
  return raw.length > 0 ? raw.slice(0, 500) : null;
}
