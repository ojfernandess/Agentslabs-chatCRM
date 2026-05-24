import { prisma } from "../db.js";
import { InboxChannelType } from "@prisma/client";
import {
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
  type InboxWhatsappCredentialSource,
} from "./inboxWhatsappConfig.js";
import { resolveEvolutionApiCredentials } from "./evolutionPlatform.js";
import {
  getEvolutionGoPlatformConfig,
  isEvolutionGoPlatformModeActive,
  resolveEvolutionGoOperationAuth,
} from "./evolutionGoPlatform.js";
import { evolutionGoLookupInstanceByRef } from "./evolutionGoApi.js";

export type EvolutionTemplateProvider = "evolution" | "evolution_go";

export type EvolutionTemplateCredentials = {
  provider: EvolutionTemplateProvider;
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  inboxId?: string;
};

async function resolveInstanceNameForEvolutionGo(
  creds: InboxWhatsappCredentialSource,
  organizationId: string,
  auth: { baseUrl: string; apiKey: string },
): Promise<string | null> {
  const instanceRef = creds.whatsappPhoneNumberId?.trim() ?? "";
  if (!instanceRef) return null;

  const platform = await getEvolutionGoPlatformConfig();
  if (isEvolutionGoPlatformModeActive(platform)) {
    const found = await evolutionGoLookupInstanceByRef({
      baseUrl: platform.baseUrl,
      apiKey: platform.globalApiKey,
      instanceRef,
    });
    return found?.name ?? instanceRef;
  }

  const found = await evolutionGoLookupInstanceByRef({
    baseUrl: auth.baseUrl,
    apiKey: auth.apiKey,
    instanceRef,
  });
  return found?.name ?? instanceRef;
}

async function credentialsFromSource(
  organizationId: string,
  creds: InboxWhatsappCredentialSource,
  inboxId?: string,
): Promise<EvolutionTemplateCredentials | null> {
  if (creds.whatsappProvider === "evolution") {
    const resolved = await resolveEvolutionApiCredentials(creds);
    if (!resolved) return null;
    return {
      provider: "evolution",
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      instanceName: resolved.instanceName,
      inboxId,
    };
  }

  if (creds.whatsappProvider === "evolution_go") {
    const auth = await resolveEvolutionGoOperationAuth(creds, organizationId);
    if (!auth) return null;
    const instanceName = await resolveInstanceNameForEvolutionGo(creds, organizationId, auth);
    if (!instanceName) return null;
    return {
      provider: "evolution_go",
      baseUrl: auth.baseUrl,
      apiKey: auth.apiKey,
      instanceName,
      inboxId,
    };
  }

  return null;
}

export async function findEvolutionTemplateInboxes(
  organizationId: string,
): Promise<Array<{ id: string; name: string; provider: EvolutionTemplateProvider }>> {
  const rows = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, name: true, channelConfig: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  const out: Array<{ id: string; name: string; provider: EvolutionTemplateProvider }> = [];
  for (const row of rows) {
    const parsed = parseInboxWhatsappFromChannelConfig(row.channelConfig);
    if (parsed.whatsappProvider !== "evolution" && parsed.whatsappProvider !== "evolution_go") continue;
    if (!parsed.whatsappPhoneNumberId?.trim()) continue;
    out.push({
      id: row.id,
      name: row.name,
      provider: parsed.whatsappProvider,
    });
  }
  return out;
}

/** Credenciais para POST /template/create (Evolution API ou Evolution Go). */
export async function resolveEvolutionTemplateCredentials(
  organizationId: string,
  opts?: { inboxId?: string },
): Promise<EvolutionTemplateCredentials | null> {
  if (opts?.inboxId) {
    const inbox = await prisma.inbox.findFirst({
      where: { id: opts.inboxId, organizationId, channelType: InboxChannelType.WHATSAPP },
      select: { id: true, channelConfig: true },
    });
    if (!inbox) return null;
    const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
    if (!creds) return null;
    return credentialsFromSource(organizationId, creds, inbox.id);
  }

  const inboxes = await findEvolutionTemplateInboxes(organizationId);
  if (inboxes.length > 0) {
    const inbox = await prisma.inbox.findFirst({
      where: { id: inboxes[0].id, organizationId },
      select: { id: true, channelConfig: true },
    });
    if (inbox) {
      const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
      if (creds) return credentialsFromSource(organizationId, creds, inbox.id);
    }
  }

  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings?.whatsappProvider) return null;
  if (settings.whatsappProvider !== "evolution" && settings.whatsappProvider !== "evolution_go") {
    return null;
  }

  return credentialsFromSource(organizationId, {
    whatsappProvider: settings.whatsappProvider,
    whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
    whatsappApiKey: settings.whatsappApiKey,
    whatsappWebhookSecret: settings.whatsappWebhookSecret,
    whatsappWebhookVerifyToken: settings.whatsappWebhookVerifyToken ?? null,
    evolutionApiBaseUrl: settings.evolutionApiBaseUrl,
  });
}
