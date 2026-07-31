/**
 * Fase 7 — Enrichment backward-compatible do Prompt IR a partir de behaviorConfig.
 * Metadados estruturados (URLs, template overrides) sem alterar playbooks legacy.
 */
import type { PromptIR } from "../contract/PromptIR.js";
import { REPLY_TEMPLATE_BODIES } from "../reply/ReplyTemplateRenderer.js";
import { playbookTextFromBehavior } from "./playbookText.js";

export type PlaybookEnrichment = {
  /** URL de check-in digital — substitui hardcode pms.audaar (P-035). */
  checkinLink?: string;
  /** Overrides de corpo por templateId. */
  replyTemplateBodies?: Record<string, string>;
  /** Facts default injectados em templates. */
  defaultTemplateFacts?: Record<string, string>;
};

export function parsePlaybookEnrichment(
  behaviorConfig: Record<string, unknown> | null | undefined,
): PlaybookEnrichment {
  if (!behaviorConfig || typeof behaviorConfig !== "object") return {};
  const raw = behaviorConfig.playbookEnrichment ?? behaviorConfig.promptEnrichment;
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const checkinLink =
    typeof o.checkinLink === "string" && o.checkinLink.trim() ? o.checkinLink.trim() : undefined;
  const replyTemplateBodies =
    o.replyTemplateBodies && typeof o.replyTemplateBodies === "object" && !Array.isArray(o.replyTemplateBodies)
      ? (o.replyTemplateBodies as Record<string, string>)
      : undefined;
  const defaultTemplateFacts =
    o.defaultTemplateFacts && typeof o.defaultTemplateFacts === "object"
      ? (o.defaultTemplateFacts as Record<string, string>)
      : undefined;
  return { checkinLink, replyTemplateBodies, defaultTemplateFacts };
}

const DEFAULT_CHECKIN_LINK = "https://pms.audaar.com.br/checkin/vivapp/access";

/** Merge enrichment no IR — idempotente por hash. */
export function enrichPromptIr(
  ir: PromptIR,
  behaviorConfig: Record<string, unknown> | null | undefined,
): PromptIR {
  const enrichment = parsePlaybookEnrichment(behaviorConfig);
  const playbook = playbookTextFromBehavior(behaviorConfig);
  const hotelLike =
    Boolean(enrichment.checkinLink) ||
    /\bcheck[- ]?in\b/i.test(playbook) ||
    /\bhospedagem\b/i.test(playbook) ||
    /\bembratur\b/i.test(playbook) ||
    ir.replyTemplates.some((t) => /s1|check.?in|reserva/i.test(t.label));

  if (!hotelLike) {
    return {
      ...ir,
      metadata: { ...ir.metadata, hash: `${ir.metadata.hash}:enriched` },
    };
  }

  const checkinLink = enrichment.checkinLink ?? DEFAULT_CHECKIN_LINK;

  const templateFacts = {
    checkinLink,
    ...(enrichment.defaultTemplateFacts ?? {}),
  };

  let reservationBody = REPLY_TEMPLATE_BODIES.reservation_lookup_checkin;
  if (enrichment.replyTemplateBodies?.reservation_lookup_checkin) {
    reservationBody = enrichment.replyTemplateBodies.reservation_lookup_checkin;
  } else if (reservationBody.includes("pms.audaar.com.br")) {
    reservationBody = reservationBody.replace(
      /https:\/\/pms\.audaar\.com\.br\/checkin\/vivapp\/access/g,
      "{{facts.checkinLink}}",
    );
  }

  const enrichedTemplates = ir.replyTemplates.map((t) => ({
    ...t,
    playbookExcerpt:
      enrichment.replyTemplateBodies?.[t.id] ??
      (t.label.toLowerCase() === "s1" ? reservationBody.slice(0, 200) : t.playbookExcerpt),
  }));

  return {
    ...ir,
    replyTemplates: enrichedTemplates,
    metadata: {
      ...ir.metadata,
      hash: `${ir.metadata.hash}:enriched`,
    },
    restrictions: [
      ...ir.restrictions,
      ...(enrichment.checkinLink ? [] : []),
    ],
    // Stash template facts for renderer (via restrictions meta — lightweight)
    preconditions: [
      ...ir.preconditions,
      `__templateFacts.checkinLink=${checkinLink}`,
      ...Object.entries(templateFacts).map(([k, v]) => `__templateFacts.${k}=${v}`),
    ],
  };
}

export function templateFactsFromEnrichedIr(ir: PromptIR): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const p of ir.preconditions) {
    const m = /^__templateFacts\.([a-zA-Z0-9_]+)=(.+)$/.exec(p);
    if (m) facts[m[1]!] = m[2]!;
  }
  if (!facts.checkinLink) facts.checkinLink = DEFAULT_CHECKIN_LINK;
  return facts;
}
