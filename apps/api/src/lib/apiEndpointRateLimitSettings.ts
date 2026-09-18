import { prisma } from "../db.js";

export const API_ENDPOINT_RATE_LIMITS_SETTING_KEY = "api_endpoint_rate_limits";

export type ApiEndpointRateLimitKey = "send_template" | "messages_post" | "templates_list";

export type ApiEndpointRateLimitKeyBy = "organization" | "api_token" | "user" | "ip";

export type ApiEndpointRateLimitRule = {
  enabled: boolean;
  max: number;
  timeWindowSeconds: number;
  keyBy: ApiEndpointRateLimitKeyBy;
};

export type ApiEndpointRateLimitConfig = {
  endpoints: Record<ApiEndpointRateLimitKey, ApiEndpointRateLimitRule>;
};

export type ApiEndpointRateLimitCatalogEntry = {
  id: ApiEndpointRateLimitKey;
  method: string;
  path: string;
  titlePt: string;
  descriptionPt: string;
  recommendedKeyBy: ApiEndpointRateLimitKeyBy;
  defaultRule: ApiEndpointRateLimitRule;
};

export const API_ENDPOINT_RATE_LIMIT_CATALOG: ApiEndpointRateLimitCatalogEntry[] = [
  {
    id: "send_template",
    method: "POST",
    path: "/api/v1/sendTemplate",
    titlePt: "Envio de template (integração externa)",
    descriptionPt:
      "Protege envios WhatsApp via integração ocu_. Limite por organização evita disparos em massa que geram custo Meta.",
    recommendedKeyBy: "organization",
    defaultRule: { enabled: true, max: 5, timeWindowSeconds: 1, keyBy: "organization" },
  },
  {
    id: "messages_post",
    method: "POST",
    path: "/api/v1/messages",
    titlePt: "Envio de mensagens (texto/template)",
    descriptionPt:
      "Protege POST de mensagens outbound (UI e API). Limite por organização; valor default um pouco acima do sendTemplate para uso normal do painel.",
    recommendedKeyBy: "organization",
    defaultRule: { enabled: true, max: 10, timeWindowSeconds: 1, keyBy: "organization" },
  },
  {
    id: "templates_list",
    method: "GET",
    path: "/api/v1/templates",
    titlePt: "Listagem de templates",
    descriptionPt:
      "Protege leitura/sync de templates (pode chamar Meta). Limite por minuto por organização — leitura, não envio.",
    recommendedKeyBy: "organization",
    defaultRule: { enabled: true, max: 60, timeWindowSeconds: 60, keyBy: "organization" },
  },
];

const ALL_KEYS = API_ENDPOINT_RATE_LIMIT_CATALOG.map((e) => e.id);

function defaultEndpoints(): Record<ApiEndpointRateLimitKey, ApiEndpointRateLimitRule> {
  return Object.fromEntries(
    API_ENDPOINT_RATE_LIMIT_CATALOG.map((e) => [e.id, { ...e.defaultRule }]),
  ) as Record<ApiEndpointRateLimitKey, ApiEndpointRateLimitRule>;
}

export const DEFAULT_API_ENDPOINT_RATE_LIMIT_CONFIG: ApiEndpointRateLimitConfig = {
  endpoints: defaultEndpoints(),
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}

function readBool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

function readNumber(obj: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function readKeyBy(raw: unknown, fallback: ApiEndpointRateLimitKeyBy): ApiEndpointRateLimitKeyBy {
  if (raw === "organization" || raw === "api_token" || raw === "user" || raw === "ip") return raw;
  return fallback;
}

function parseRule(raw: unknown, fallback: ApiEndpointRateLimitRule): ApiEndpointRateLimitRule {
  const obj = asRecord(raw);
  if (!obj) return { ...fallback };
  return {
    enabled: readBool(obj, "enabled", fallback.enabled),
    max: readNumber(obj, "max", fallback.max, 1, 10_000),
    timeWindowSeconds: readNumber(obj, "timeWindowSeconds", fallback.timeWindowSeconds, 1, 86_400),
    keyBy: readKeyBy(obj.keyBy, fallback.keyBy),
  };
}

export function parseApiEndpointRateLimitConfig(raw: unknown): ApiEndpointRateLimitConfig {
  const defaults = defaultEndpoints();
  const root = asRecord(raw);
  const endpointsRaw = root ? asRecord(root.endpoints) : null;
  const endpoints = { ...defaults };
  for (const id of ALL_KEYS) {
    endpoints[id] = parseRule(endpointsRaw?.[id], defaults[id]);
  }
  return { endpoints };
}

export async function getApiEndpointRateLimitConfig(): Promise<ApiEndpointRateLimitConfig> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: API_ENDPOINT_RATE_LIMITS_SETTING_KEY },
    select: { value: true },
  });
  if (!row) return { endpoints: defaultEndpoints() };
  return parseApiEndpointRateLimitConfig(row.value);
}

let cachedConfig: ApiEndpointRateLimitConfig | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

export async function getCachedApiEndpointRateLimitConfig(): Promise<ApiEndpointRateLimitConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) return cachedConfig;
  cachedConfig = await getApiEndpointRateLimitConfig();
  cachedAt = now;
  return cachedConfig;
}

export function invalidateApiEndpointRateLimitConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}
