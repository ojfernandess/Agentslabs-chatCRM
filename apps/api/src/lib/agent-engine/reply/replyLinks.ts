/**
 * Normalização e deduplicação genérica de URLs em replies outbound (todos os segmentos).
 */

import { isLikelyCheckinUrl, pickPreferredCheckinUrl } from "./checkinLink.js";

const PLAIN_URL_RE = /https?:\/\/[^\s)\]>]+/gi;
const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(\s*([^)]*)\s*\)/g;

export function normalizeUrlForComparison(url: string): string {
  return url.trim().replace(/[.,;:!?)]+$/, "").replace(/\/+$/, "").toLowerCase();
}

/** Converte links markdown para URL pura — ex.: `[https://x/]()` → `https://x/` */
export function normalizeMarkdownLinksInReply(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return t;

  return t.replace(MARKDOWN_LINK_RE, (_match, label: string, href: string) => {
    const labelUrl = (label ?? "").trim().match(/^https?:\/\/[^\s)\]>]+/i)?.[0]?.replace(/[.,;:!?)]+$/, "");
    const hrefUrl = (href ?? "").trim().match(/^https?:\/\/[^\s)\]>]+/i)?.[0]?.replace(/[.,;:!?)]+$/, "");
    if (hrefUrl) return hrefUrl;
    if (labelUrl) return labelUrl;
    return label?.trim() || "";
  });
}

export type UrlHit = { index: number; length: number; url: string };

export function extractUrlHitsFromReply(text: string): UrlHit[] {
  const t = normalizeMarkdownLinksInReply(text);
  const hits: UrlHit[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PLAIN_URL_RE.source, "gi");
  while ((m = re.exec(t)) !== null) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    const key = normalizeUrlForComparison(url);
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ index: m.index, length: m[0].length, url });
  }
  return hits;
}

/** Remove URLs duplicadas (qualquer domínio) — mantém variantes distintas, deduplica repetidas. */
export function deduplicateUrlsInReply(text: string): string {
  const t = normalizeMarkdownLinksInReply((text ?? "").trim());
  if (!t) return t;

  const hits: UrlHit[] = [];
  const re = new RegExp(PLAIN_URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    hits.push({ index: m.index, length: m[0].length, url: m[0].replace(/[.,;:!?)]+$/, "") });
  }
  if (hits.length <= 1) return t;

  const seenNormalized = new Set<string>();
  const toRemove = new Set<number>();

  for (let i = 0; i < hits.length; i++) {
    const key = normalizeUrlForComparison(hits[i]!.url);
    if (seenNormalized.has(key)) toRemove.add(i);
    else seenNormalized.add(key);
  }

  const remainingCheckin = hits.filter(
    (_, i) => !toRemove.has(i) && isLikelyCheckinUrl(hits[i]!.url),
  );
  if (remainingCheckin.length > 1) {
    const preferred = pickPreferredCheckinUrl(remainingCheckin.map((h) => h.url));
    const preferredKey = normalizeUrlForComparison(preferred);
    let keptCheckin = false;
    for (let i = 0; i < hits.length; i++) {
      if (toRemove.has(i) || !isLikelyCheckinUrl(hits[i]!.url)) continue;
      const key = normalizeUrlForComparison(hits[i]!.url);
      if (key === preferredKey) {
        if (keptCheckin) toRemove.add(i);
        else keptCheckin = true;
      } else {
        toRemove.add(i);
      }
    }
  }

  if (!toRemove.size) return t;

  let out = "";
  let lastEnd = 0;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    out += t.slice(lastEnd, hit.index);
    if (!toRemove.has(i)) out += hit.url;
    lastEnd = hit.index + hit.length;
  }
  out += t.slice(lastEnd);
  return cleanupReplySpacing(out);
}

function cleanupReplySpacing(text: string): string {
  let out = text.replace(/^\s*🔗\s*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** Pipeline outbound: markdown → URL pura + deduplicação genérica. */
export function sanitizeOutboundLinksInReply(text: string): string {
  return deduplicateUrlsInReply(normalizeMarkdownLinksInReply(text));
}
