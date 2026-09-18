import { prisma } from "../db.js";

/**
 * Fases da política de cobrança Meta — configurável (Super Admin).
 * Permite transição automática (ex.: Out/2026) sem alterar código.
 */

export const META_BILLING_POLICY_PLATFORM_KEY = "meta_billing_policy_phases";

export type MetaBillingPolicyPhase = {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Mensagens Service (non-template) in-window são gratuitas. */
  serviceInWindowFree: boolean;
  /** Templates Utility in-window são gratuitos. */
  utilityInWindowFree: boolean;
  /** Franquia mensal Service por número (Out/2026: 1000). null = sem franquia modelada. */
  serviceFreeTierPerNumberPerMonth: number | null;
  source: string;
};

/** Defaults alinhados à documentação Meta (Jul–Set/2026 vs Out/2026+). */
export const DEFAULT_META_BILLING_POLICY_PHASES: MetaBillingPolicyPhase[] = [
  {
    id: "pre-2026-10",
    label: "Jul–Set 2026 — Service/Utility in-window gratuitos",
    effectiveFrom: "2025-07-01",
    effectiveUntil: "2026-09-30",
    serviceInWindowFree: true,
    utilityInWindowFree: true,
    serviceFreeTierPerNumberPerMonth: null,
    source: "https://developers.facebook.com/docs/whatsapp/pricing/",
  },
  {
    id: "from-2026-10",
    label: "Out 2026+ — Service/Utility in-window cobráveis; 1000 Service grátis/mês",
    effectiveFrom: "2026-10-01",
    effectiveUntil: null,
    serviceInWindowFree: false,
    utilityInWindowFree: false,
    serviceFreeTierPerNumberPerMonth: 1000,
    source: "https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/",
  },
];

function parsePhase(raw: unknown): MetaBillingPolicyPhase | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.effectiveFrom !== "string" || !o.effectiveFrom.trim()) return null;
  const tierRaw = o.serviceFreeTierPerNumberPerMonth;
  let tier: number | null = null;
  if (typeof tierRaw === "number" && Number.isFinite(tierRaw) && tierRaw >= 0) {
    tier = Math.floor(tierRaw);
  } else if (typeof tierRaw === "string" && tierRaw.trim() && Number.isFinite(Number(tierRaw))) {
    const v = Math.floor(Number(tierRaw));
    tier = v >= 0 ? v : null;
  }
  return {
    id: o.id.trim().slice(0, 64),
    label: typeof o.label === "string" ? o.label.slice(0, 255) : o.id,
    effectiveFrom: o.effectiveFrom.trim().slice(0, 32),
    effectiveUntil:
      typeof o.effectiveUntil === "string" && o.effectiveUntil.trim()
        ? o.effectiveUntil.trim().slice(0, 32)
        : null,
    serviceInWindowFree: o.serviceInWindowFree !== false,
    utilityInWindowFree: o.utilityInWindowFree !== false,
    serviceFreeTierPerNumberPerMonth: tier,
    source:
      typeof o.source === "string" && o.source.trim()
        ? o.source.slice(0, 255)
        : "https://developers.facebook.com/docs/whatsapp/pricing/",
  };
}

export function parseMetaBillingPolicyPhases(value: unknown): MetaBillingPolicyPhase[] {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_META_BILLING_POLICY_PHASES];
  const parsed = value.map(parsePhase).filter((p): p is MetaBillingPolicyPhase => p != null);
  return parsed.length > 0 ? parsed : [...DEFAULT_META_BILLING_POLICY_PHASES];
}

export async function getMetaBillingPolicyPhases(): Promise<MetaBillingPolicyPhase[]> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: META_BILLING_POLICY_PLATFORM_KEY },
    select: { value: true },
  });
  return parseMetaBillingPolicyPhases(row?.value);
}

export async function saveMetaBillingPolicyPhases(phases: MetaBillingPolicyPhase[]): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: META_BILLING_POLICY_PLATFORM_KEY },
    create: { key: META_BILLING_POLICY_PLATFORM_KEY, value: phases },
    update: { value: phases },
  });
}

function parsePhaseDate(isoDate: string, endOfDay: boolean): Date {
  const d = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T00:00:00.000Z`);
  if (endOfDay) d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Fase vigente para uma data (WABA timezone simplificado = UTC). */
export function resolveActiveBillingPolicyPhase(
  phases: MetaBillingPolicyPhase[],
  at: Date = new Date(),
): MetaBillingPolicyPhase {
  const sorted = [...phases].sort(
    (a, b) => parsePhaseDate(a.effectiveFrom, false).getTime() - parsePhaseDate(b.effectiveFrom, false).getTime(),
  );
  let active = sorted[0] ?? DEFAULT_META_BILLING_POLICY_PHASES[0]!;
  for (const phase of sorted) {
    const from = parsePhaseDate(phase.effectiveFrom, false);
    const until = phase.effectiveUntil ? parsePhaseDate(phase.effectiveUntil, true) : null;
    if (at.getTime() < from.getTime()) break;
    if (until && at.getTime() > until.getTime()) continue;
    active = phase;
  }
  return active;
}

export async function getActiveBillingPolicyPhase(at?: Date): Promise<MetaBillingPolicyPhase> {
  const phases = await getMetaBillingPolicyPhases();
  return resolveActiveBillingPolicyPhase(phases, at ?? new Date());
}
