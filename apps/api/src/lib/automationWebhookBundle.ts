import { prisma } from "../db.js";

const TOOL_SECRET_KEYS = [
  "apiKey",
  "api_key",
  "accessToken",
  "refreshToken",
  "refresh_token",
  "client_secret",
  "password",
  "smtpPassword",
  "token",
  "authToken",
  "botToken",
  "secretKey",
  "bearerToken",
  "apiKeyValue",
  "basicPassword",
  "customAuthValue",
  "signingSecret",
  "connectionString",
  "credentialsJson",
] as const;

/** Redige credenciais em `config` de ferramentas antes de enviar ao webhook do agent bot. */
export function redactAutomationToolConfig(cfg: unknown): Record<string, unknown> {
  const out = cfg && typeof cfg === "object" ? { ...(cfg as Record<string, unknown>) } : {};
  for (const k of TOOL_SECRET_KEYS) {
    if (k in out && out[k]) (out as Record<string, unknown>)[k] = "***";
  }
  return out;
}

function redactLlmForWebhook(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== "object") return {};
  const c = { ...(config as Record<string, unknown>) };
  if ("apiKey" in c && c.apiKey) c.apiKey = "***";
  return c;
}

/**
 * Pacote de automação (perfil + ferramentas) para o integrador no webhook do bot.
 * - Se existir `behavior.connectedTools` com entradas `enabled: true`, só essas ferramentas são listadas.
 * - Se `connectedTools` estiver vazio ou ausente, inclui todas as ferramentas ativas da organização (compatibilidade).
 * - Se existir `connectedTools` mas nenhuma `enabled`, devolve lista de ferramentas vazia.
 */
export async function loadAutomationWebhookBundle(
  organizationId: string,
  botId: string,
): Promise<Record<string, unknown> | null> {
  const profile = await prisma.automationAgentProfile.findFirst({
    where: { botId, organizationId },
    select: {
      id: true,
      llmConfig: true,
      behaviorConfig: true,
      promptModuleIds: true,
    },
  });
  if (!profile) return null;

  const behavior =
    profile.behaviorConfig && typeof profile.behaviorConfig === "object"
      ? { ...(profile.behaviorConfig as Record<string, unknown>) }
      : {};
  const connectedRaw = behavior.connectedTools;

  let legacyAllTools = false;
  let allowedIds: Set<string> | null = null;

  if (!Array.isArray(connectedRaw) || connectedRaw.length === 0) {
    legacyAllTools = true;
  } else {
    const enabledIds = connectedRaw
      .filter(
        (x): x is Record<string, unknown> =>
          Boolean(x) && typeof x === "object" && (x as Record<string, unknown>).enabled === true,
      )
      .map((x) => String(x.toolId ?? ""))
      .filter(Boolean);
    if (enabledIds.length > 0) allowedIds = new Set(enabledIds);
    else allowedIds = new Set();
  }

  const allTools = await prisma.automationCustomTool.findMany({
    where: { organizationId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      toolType: true,
      config: true,
      parametersSchema: true,
      tags: true,
    },
  });

  const tools = allTools.filter((t) => legacyAllTools || (allowedIds !== null && allowedIds.has(t.id)));

  const bindingsById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(connectedRaw)) {
    for (const item of connectedRaw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (typeof o.toolId === "string") bindingsById.set(o.toolId, o);
    }
  }

  return {
    bundleVersion: 1,
    automationProfileId: profile.id,
    llm: redactLlmForWebhook(profile.llmConfig),
    behavior,
    promptModuleIds: profile.promptModuleIds ?? null,
    tools: tools.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      toolType: t.toolType,
      parametersSchema: t.parametersSchema,
      config: redactAutomationToolConfig(t.config),
      tags: t.tags,
      binding: bindingsById.get(t.id) ?? null,
    })),
  };
}
