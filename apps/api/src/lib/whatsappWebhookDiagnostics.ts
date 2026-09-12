import { InboxChannelType, MessageDirection } from "@prisma/client";
import { getPublicOrigin } from "../config.js";
import { prisma } from "../db.js";
import { resolveEvolutionApiCredentials } from "./evolutionPlatform.js";
import { evolutionApiFindWebhook } from "./evolutionInstanceApi.js";
import {
  isInboxWhatsappConfiguredFromChannelConfig,
  isMetaCloudWhatsappProvider,
  parseInboxWhatsappFromChannelConfig,
  whatsappWebhookMetaFromConfig,
} from "./inboxWhatsappConfig.js";
import { metaWebhookDiagnosticsFromConfig } from "./whatsappWebhookRouting.js";

export const WHATSAPP_MONITOR_PROVIDERS = [
  "meta",
  "360dialog",
  "evolution",
  "evolution_go",
  "twilio",
] as const;

export type WhatsappMonitorProvider = (typeof WHATSAPP_MONITOR_PROVIDERS)[number];

export type WhatsappWebhookDiagnosticsRow = {
  inboxId: string;
  inboxName: string;
  isDefault: boolean;
  provider: string | null;
  configured: boolean;
  webhookUrl: string | null;
  orgWebhookUrl: string | null;
  webhookSecretConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  lastWebhookAttemptAt: string | null;
  lastWebhookAttemptStatus: string | null;
  lastWebhookAttemptError: string | null;
  lastInboundWebhookAt: string | null;
  receivingOk: boolean;
  recentInboundCount: number;
  instanceName: string | null;
  evolutionRemoteWebhook: {
    url: string | null;
    enabled: boolean;
    events: string[];
  } | null;
  hints: string[];
};

function isReceivingOk(lastInboundAt: string | null, withinDays = 7): boolean {
  if (!lastInboundAt) return false;
  const ts = Date.parse(lastInboundAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= withinDays * 24 * 60 * 60 * 1000;
}

function publicUrlHints(): string[] {
  const origin = getPublicOrigin().toLowerCase();
  const hints: string[] = [];
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    hints.push(
      "PUBLIC_URL aponta para localhost — a Evolution/Meta/Twilio externa não consegue entregar webhooks. Use URL pública HTTPS ou hostname Docker acessível (ex.: http://api:3000).",
    );
  }
  return hints;
}

function providerHints(
  provider: string | null,
  row: {
    configured: boolean;
    receivingOk: boolean;
    lastWebhookAttemptStatus: string | null;
    lastWebhookAttemptError: string | null;
    evolutionRemoteWebhook: WhatsappWebhookDiagnosticsRow["evolutionRemoteWebhook"];
  },
): string[] {
  const hints: string[] = [];
  if (!provider) {
    hints.push("Provider WhatsApp não configurado nesta caixa.");
    return hints;
  }
  if (!row.configured) {
    hints.push("Credenciais incompletas — verifique instance name, API key e URL base.");
  }
  if (row.lastWebhookAttemptStatus === "rejected") {
    hints.push(
      `Último webhook rejeitado${row.lastWebhookAttemptError ? `: ${row.lastWebhookAttemptError}` : ""}.`,
    );
  }
  if (!row.receivingOk && row.lastWebhookAttemptAt) {
    hints.push("Webhooks chegam mas nenhum inbound processado nos últimos 7 dias — verifique parsing ou contactos bloqueados.");
  }
  if (!row.receivingOk && !row.lastWebhookAttemptAt) {
    hints.push("Nenhum webhook recebido ainda — confirme URL e eventos no provider externo.");
  }

  if (provider === "evolution" || provider === "evolution_go") {
    if (row.evolutionRemoteWebhook && !row.evolutionRemoteWebhook.enabled) {
      hints.push("Webhook desativado na instância Evolution.");
    }
    if (
      row.evolutionRemoteWebhook?.url &&
      !row.evolutionRemoteWebhook.events.some((e) => e.toUpperCase().includes("MESSAGES_UPSERT"))
    ) {
      hints.push("Evento MESSAGES_UPSERT não está ativo no webhook da Evolution.");
    }
    hints.push("Outbound usa REST; inbound exige webhook MESSAGES_UPSERT. Re-salve a caixa ou use Testar conexão para re-registrar.");
  }

  if (isMetaCloudWhatsappProvider(provider)) {
    hints.push("Meta/360dialog: confirme App Secret em whatsappWebhookSecret e subscrição WABA.");
  }

  if (provider === "twilio") {
    hints.push("Twilio usa URL pública com ingestToken — configure o webhook de mensagens inbound no console Twilio.");
  }

  return hints;
}

export async function buildWhatsappWebhookDiagnosticsForInbox(input: {
  organizationId: string;
  inboxId: string;
  inboxName: string;
  isDefault: boolean;
  channelConfig: unknown;
  ingestToken?: string | null;
  includeEvolutionRemote?: boolean;
}): Promise<WhatsappWebhookDiagnosticsRow> {
  const parsed = parseInboxWhatsappFromChannelConfig(input.channelConfig);
  const provider = parsed.whatsappProvider ?? null;
  const configured = isInboxWhatsappConfiguredFromChannelConfig(input.channelConfig);
  const attempt = metaWebhookDiagnosticsFromConfig(input.channelConfig);
  const receivingOk = isReceivingOk(attempt.lastInboundWebhookAt);

  let webhookUrl: string | null = null;
  let orgWebhookUrl: string | null = `${getPublicOrigin()}/webhooks/whatsapp/${input.organizationId}`;

  if (provider === "twilio" && input.ingestToken) {
    webhookUrl = `${getPublicOrigin()}/api/v1/public/inbox/${input.ingestToken}/twilio`;
  } else if (provider && provider !== "twilio") {
    const meta = whatsappWebhookMetaFromConfig(input.channelConfig, input.organizationId, input.inboxId);
    webhookUrl = meta.webhookUrl;
  }

  let evolutionRemoteWebhook: WhatsappWebhookDiagnosticsRow["evolutionRemoteWebhook"] = null;
  if (input.includeEvolutionRemote !== false && (provider === "evolution" || provider === "evolution_go")) {
    const creds = {
      whatsappProvider: provider,
      evolutionApiBaseUrl: parsed.evolutionApiBaseUrl ?? null,
      whatsappPhoneNumberId: parsed.whatsappPhoneNumberId ?? null,
      whatsappApiKey: parsed.whatsappApiKey ?? null,
    };
    const resolved =
      provider === "evolution"
        ? await resolveEvolutionApiCredentials(creds)
        : null;
    if (resolved) {
      evolutionRemoteWebhook = await evolutionApiFindWebhook({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        instanceName: resolved.instanceName,
      });
    }
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentInboundCount = await prisma.message.count({
    where: {
      direction: MessageDirection.INBOUND,
      createdAt: { gte: since },
      conversation: { inboxId: input.inboxId, organizationId: input.organizationId },
    },
  });

  const rowBase = {
    configured,
    receivingOk,
    lastWebhookAttemptStatus: attempt.lastWebhookAttemptStatus,
    lastWebhookAttemptError: attempt.lastWebhookAttemptError,
    evolutionRemoteWebhook,
  };

  const hints = [...publicUrlHints(), ...providerHints(provider, rowBase)];
  if (
    provider === "evolution" &&
    webhookUrl &&
    evolutionRemoteWebhook?.url &&
    evolutionRemoteWebhook.url !== webhookUrl &&
    !evolutionRemoteWebhook.url.includes(input.inboxId)
  ) {
    hints.push(
      `URL remota na Evolution (${evolutionRemoteWebhook.url}) difere da URL OpenConduit (${webhookUrl}) — re-registe o webhook.`,
    );
  }

  return {
    inboxId: input.inboxId,
    inboxName: input.inboxName,
    isDefault: input.isDefault,
    provider,
    configured,
    webhookUrl,
    orgWebhookUrl,
    webhookSecretConfigured: attempt.webhookSecretConfigured,
    webhookVerifyTokenConfigured: attempt.webhookVerifyTokenConfigured,
    lastWebhookAttemptAt: attempt.lastWebhookAttemptAt,
    lastWebhookAttemptStatus: attempt.lastWebhookAttemptStatus,
    lastWebhookAttemptError: attempt.lastWebhookAttemptError,
    lastInboundWebhookAt: attempt.lastInboundWebhookAt,
    receivingOk,
    recentInboundCount,
    instanceName: parsed.whatsappPhoneNumberId ?? null,
    evolutionRemoteWebhook,
    hints,
  };
}

export async function searchWhatsappWebhookDiagnostics(input: {
  organizationId: string;
  inboxId?: string;
  provider?: string;
  errorOnly?: boolean;
  limit?: number;
  includeEvolutionRemote?: boolean;
}): Promise<{
  publicUrl: string;
  inboxes: WhatsappWebhookDiagnosticsRow[];
  summary: {
    total: number;
    receivingOk: number;
    withErrors: number;
    notConfigured: number;
  };
}> {
  const rows = await prisma.inbox.findMany({
    where: {
      organizationId: input.organizationId,
      channelType: InboxChannelType.WHATSAPP,
      ...(input.inboxId ? { id: input.inboxId } : {}),
    },
    select: {
      id: true,
      name: true,
      isDefault: true,
      channelConfig: true,
      ingestToken: true,
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    take: Math.min(input.limit ?? 20, 50),
  });

  const providerFilter = input.provider?.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (!providerFilter) return true;
    const p = parseInboxWhatsappFromChannelConfig(row.channelConfig).whatsappProvider;
    return p === providerFilter;
  });

  const inboxes: WhatsappWebhookDiagnosticsRow[] = [];
  for (const row of filtered) {
    const diag = await buildWhatsappWebhookDiagnosticsForInbox({
      organizationId: input.organizationId,
      inboxId: row.id,
      inboxName: row.name,
      isDefault: row.isDefault,
      channelConfig: row.channelConfig,
      ingestToken: row.ingestToken,
      includeEvolutionRemote: input.includeEvolutionRemote,
    });
    if (input.errorOnly && diag.receivingOk && !diag.lastWebhookAttemptError) continue;
    inboxes.push(diag);
  }

  return {
    publicUrl: getPublicOrigin(),
    inboxes,
    summary: {
      total: inboxes.length,
      receivingOk: inboxes.filter((i) => i.receivingOk).length,
      withErrors: inboxes.filter((i) => i.lastWebhookAttemptStatus === "rejected" || i.lastWebhookAttemptError).length,
      notConfigured: inboxes.filter((i) => !i.configured).length,
    },
  };
}
