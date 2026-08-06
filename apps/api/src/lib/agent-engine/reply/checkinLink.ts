/**
 * Resolução genérica de URLs de check-in digital — base, localizador, deduplicação.
 * Evita hardcode por prompt: lê enrichment, playbook ou fallback padrão.
 */

import { deduplicateUrlsInReply } from "./replyLinks.js";

export const DEFAULT_CHECKIN_BASE_URL = "https://checkin.audaar.com.br/";

export const CHECKIN_LOCATOR_PLACEHOLDER = "{LOCALIZADOR}";

export type CheckinLinkResolveOptions = {
  locator?: string | null;
  /** behaviorConfig.playbookEnrichment.checkinLink */
  configuredLink?: string | null;
  /** Markdown do playbook — extrai base URL automaticamente */
  playbookText?: string | null;
};

const LOCATOR_RE = /^[A-Z0-9]{5,14}$/i;

export function normalizeCheckinUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function isLikelyCheckinUrl(url: string): boolean {
  const u = url.toLowerCase();
  if (/checkin\.audaar\.com/i.test(u)) return true;
  if (/pms\.audaar\.com\.br\/checkin/i.test(u)) return true;
  if (/\/check[-_]?in\b/i.test(u)) return true;
  if (/check[-_]?in/i.test(u) && /audaar|vivapp|hospedagem/i.test(u)) return true;
  return false;
}

function cleanLocator(raw?: string | null): string | null {
  const loc = raw?.trim().toUpperCase();
  if (!loc || loc === "…") return null;
  const clean = loc.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!LOCATOR_RE.test(clean)) return null;
  return clean;
}

export function extractCheckinUrlsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /https?:\/\/[^\s)\]>]+/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/[.,;:!?)]+$/, "");
    if (isLikelyCheckinUrl(raw) && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

/** Extrai URL base do playbook (suporta {LOCALIZADOR} e URLs legadas). */
export function extractCheckinBaseUrlFromPlaybook(playbookText: string): string | null {
  const t = playbookText.trim();
  if (!t) return null;

  const templateMatch = t.match(/https?:\/\/checkin\.audaar\.com\.br\/(?:\{LOCALIZADOR\})?/i);
  if (templateMatch) {
    return `${templateMatch[0].replace(/\{LOCALIZADOR\}/i, "").replace(/\/+$/, "")}/`;
  }

  const urls = extractCheckinUrlsFromText(t);
  for (const url of urls) {
    const withoutLocator = url.replace(/\/[A-Z0-9]{5,14}\/?$/i, "");
    if (/checkin\.audaar\.com\.br/i.test(withoutLocator)) {
      return `${withoutLocator.replace(/\/+$/, "")}/`;
    }
    if (/pms\.audaar\.com\.br\/checkin/i.test(url)) {
      return url.replace(/\/+$/, "");
    }
  }
  return null;
}

function parseConfiguredCheckinLink(configured: string): { baseUrl: string; isTemplate: boolean } {
  const c = configured.trim();
  if (/\{LOCALIZADOR\}/i.test(c)) {
    const base = c.replace(/\{LOCALIZADOR\}/i, "").replace(/\/+$/, "");
    return { baseUrl: `${base}/`, isTemplate: true };
  }
  if (/\/[A-Z0-9]{5,14}\/?$/i.test(c) && isLikelyCheckinUrl(c)) {
    return {
      baseUrl: `${c.replace(/\/[A-Z0-9]{5,14}\/?$/i, "").replace(/\/+$/, "")}/`,
      isTemplate: false,
    };
  }
  return { baseUrl: c.endsWith("/") ? c : `${c}/`, isTemplate: false };
}

/** Monta URL de check-in com base + localizador opcional. */
export function buildCheckinLink(opts?: { locator?: string | null; baseUrl?: string | null }): string {
  const base = (opts?.baseUrl?.trim() || DEFAULT_CHECKIN_BASE_URL).replace(/\/+$/, "");
  const locator = cleanLocator(opts?.locator);
  if (locator) return `${base}/${locator}`;
  return `${base}/`;
}

/** Ponto único de entrada — enrichment, playbook ou fallback. */
export function resolveCheckinLink(opts: CheckinLinkResolveOptions = {}): string {
  const locator = cleanLocator(opts.locator);

  if (opts.configuredLink?.trim()) {
    const cfg = opts.configuredLink.trim();
    const { baseUrl, isTemplate } = parseConfiguredCheckinLink(cfg);
    if (locator) return buildCheckinLink({ locator, baseUrl });
    if (!isTemplate) return cfg;
    return buildCheckinLink({ baseUrl });
  }

  const fromPlaybook = opts.playbookText ? extractCheckinBaseUrlFromPlaybook(opts.playbookText) : null;
  return buildCheckinLink({ locator, baseUrl: fromPlaybook });
}

export function pickPreferredCheckinUrl(urls: string[]): string {
  const withLocator = urls.filter((u) => /checkin\.audaar\.com\.br\/[A-Z0-9]{5,}/i.test(u));
  if (withLocator.length) return withLocator[0]!;
  const newDomain = urls.filter((u) => /checkin\.audaar\.com/i.test(u));
  if (newDomain.length) return newDomain[0]!;
  return urls[0]!;
}

/** @deprecated Use deduplicateUrlsInReply — mantido para compat. */
export function deduplicateCheckinLinksInReply(text: string): string {
  return deduplicateUrlsInReply(text);
}
