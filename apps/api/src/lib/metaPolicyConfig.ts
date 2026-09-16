import { prisma } from "../db.js";

/**
 * Versões da política/preços da Meta — camada configurável (Super Admin → Platform Settings).
 * A política da Meta é dependência externa: quando mudar, atualiza-se esta configuração
 * (e a tabela `whatsapp_pricing_rules`) sem reescrever o sistema.
 */

export const META_POLICY_PLATFORM_KEY = "meta_policy_versions";

export type MetaPolicyVersions = {
  metaPolicyVersion: string;
  metaPricingVersion: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  source: string;
  /** Franquia Service configurável (nunca hardcoded). null = informação ainda não disponível. */
  serviceFreeMessagesPerNumberPerMonth: number | null;
};

export const DEFAULT_META_POLICY_VERSIONS: MetaPolicyVersions = {
  metaPolicyVersion: "",
  metaPricingVersion: "",
  effectiveFrom: null,
  effectiveUntil: null,
  source: "https://business.whatsapp.com/policy",
  serviceFreeMessagesPerNumberPerMonth: null,
};

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v.slice(0, 255) : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.slice(0, 64) : null;
}

export function parseMetaPolicyVersions(value: unknown): MetaPolicyVersions {
  if (!value || typeof value !== "object") return { ...DEFAULT_META_POLICY_VERSIONS };
  const o = value as Record<string, unknown>;
  return {
    metaPolicyVersion: str(o.metaPolicyVersion, ""),
    metaPricingVersion: str(o.metaPricingVersion, ""),
    effectiveFrom: strOrNull(o.effectiveFrom),
    effectiveUntil: strOrNull(o.effectiveUntil),
    source: str(o.source, DEFAULT_META_POLICY_VERSIONS.source),
    serviceFreeMessagesPerNumberPerMonth: (() => {
      const n = o.serviceFreeMessagesPerNumberPerMonth;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) return Math.floor(n);
      if (typeof n === "string" && n.trim() && Number.isFinite(Number(n))) {
        const v = Math.floor(Number(n));
        return v >= 0 ? v : null;
      }
      return null;
    })(),
  };
}

export async function getMetaPolicyVersions(): Promise<MetaPolicyVersions> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: META_POLICY_PLATFORM_KEY },
    select: { value: true },
  });
  return parseMetaPolicyVersions(row?.value);
}

export async function saveMetaPolicyVersions(next: MetaPolicyVersions): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: META_POLICY_PLATFORM_KEY },
    create: { key: META_POLICY_PLATFORM_KEY, value: next },
    update: { value: next },
  });
}
