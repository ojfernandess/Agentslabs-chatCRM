export type BroadcastErrorCategory =
  | "invalid_number"
  | "carrier_block"
  | "gateway"
  | "whatsapp_window"
  | "template"
  | "flow_skip"
  | "voice"
  | "email"
  | "rate_limit"
  | "unknown";

export interface ClassifiedBroadcastError {
  category: BroadcastErrorCategory;
}

const RULES: { category: BroadcastErrorCategory; patterns: RegExp[] }[] = [
  {
    category: "flow_skip",
    patterns: [/skipped by flow/i, /flow condition/i],
  },
  {
    category: "invalid_number",
    patterns: [
      /invalid.*(phone|number|n[uú]mero)/i,
      /n[uú]mero inv[aá]lido/i,
      /not a valid/i,
      /e\.164/i,
      /malformed/i,
    ],
  },
  {
    category: "carrier_block",
    patterns: [
      /carrier/i,
      /operadora/i,
      /blocked by/i,
      /bloqueio/i,
      /opt.?out/i,
      /blacklist/i,
      /undeliverable/i,
    ],
  },
  {
    category: "whatsapp_window",
    patterns: [
      /24.?h/i,
      /window/i,
      /session.*expir/i,
      /outside.*conversation/i,
      /re-?engagement/i,
    ],
  },
  {
    category: "template",
    patterns: [
      /template/i,
      /modelo/i,
      /meta cloud/i,
      /whatsapp cloud/i,
      /synced for that number/i,
    ],
  },
  {
    category: "voice",
    patterns: [/nvoip/i, /torpedo/i, /tts/i, /voice/i, /ramal/i],
  },
  {
    category: "email",
    patterns: [/smtp/i, /email/i, /bounce/i, /mailbox/i],
  },
  {
    category: "rate_limit",
    patterns: [/rate limit/i, /throttl/i, /too many/i, /429/i],
  },
  {
    category: "gateway",
    patterns: [
      /gateway/i,
      /evolution/i,
      /timeout/i,
      /connection/i,
      /delivery failed/i,
      /falha ao enviar/i,
      /whatsapp delivery/i,
      /provider/i,
      /api error/i,
      /5\d{2}/,
    ],
  },
];

export function classifyBroadcastError(raw: string | null | undefined): ClassifiedBroadcastError {
  const msg = (raw ?? "").trim();
  if (!msg) return { category: "unknown" };
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(msg))) {
      return { category: rule.category };
    }
  }
  return { category: "unknown" };
}

export function groupErrorsByCategory(
  rows: { error: string | null; phone: string | null }[],
  maxPhonesPerCategory = 25,
): {
  category: BroadcastErrorCategory;
  count: number;
  sampleMessage: string | null;
  affectedPhones: string[];
}[] {
  const map = new Map<
    BroadcastErrorCategory,
    { count: number; sampleMessage: string | null; phones: Set<string> }
  >();

  for (const row of rows) {
    const { category } = classifyBroadcastError(row.error);
    let bucket = map.get(category);
    if (!bucket) {
      bucket = { count: 0, sampleMessage: row.error, phones: new Set() };
      map.set(category, bucket);
    }
    bucket.count += 1;
    if (!bucket.sampleMessage && row.error) bucket.sampleMessage = row.error;
    if (row.phone && bucket.phones.size < maxPhonesPerCategory) {
      bucket.phones.add(row.phone);
    }
  }

  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      count: v.count,
      sampleMessage: v.sampleMessage,
      affectedPhones: [...v.phones],
    }))
    .sort((a, b) => b.count - a.count);
}
