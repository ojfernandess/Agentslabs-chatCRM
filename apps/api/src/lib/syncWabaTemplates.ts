import type { FastifyBaseLogger } from "fastify";
import { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { decrypt } from "./encryption.js";
import {
  isMetaCloudWhatsappProvider,
  parseInboxWhatsappFromChannelConfig,
  resolveInboxWhatsappCredentials,
} from "./inboxWhatsappConfig.js";
import {
  fetchWabaIdFromPhoneNumberId,
  listApprovedWabaMessageTemplates,
  metaTemplateToLocalFields,
} from "./metaWabaTemplates.js";

export type WabaTemplateSyncResult = {
  synced: number;
  wabaId: string | null;
  source: "inbox" | "settings" | null;
};

async function persistWabaTemplates(organizationId: string, list: Awaited<ReturnType<typeof listApprovedWabaMessageTemplates>>): Promise<number> {
  let count = 0;
  for (const row of list) {
    const fields = metaTemplateToLocalFields(row);
    const existing = await prisma.messageTemplate.findFirst({
      where: {
        organizationId,
        providerTemplateId: fields.providerTemplateId,
        templateLanguage: fields.templateLanguage,
      },
    });
    if (existing) {
      await prisma.messageTemplate.update({
        where: { id: existing.id },
        data: {
          name: fields.name,
          body: fields.body,
          bodyVariableCount: fields.bodyVariableCount,
          metaCategory: fields.metaCategory,
          isApproved: fields.isApproved,
        },
      });
    } else {
      await prisma.messageTemplate.create({
        data: { ...fields, organizationId },
      });
    }
    count += 1;
  }
  return count;
}

async function syncFromCredentials(
  organizationId: string,
  creds: {
    whatsappPhoneNumberId: string | null;
    whatsappApiKey: string | null;
    whatsappBusinessAccountId?: string | null;
  },
  source: "inbox" | "settings",
  log?: FastifyBaseLogger,
): Promise<WabaTemplateSyncResult> {
  const phoneId = creds.whatsappPhoneNumberId?.trim() ?? "";
  const apiKeyEnc = creds.whatsappApiKey?.trim() ?? "";
  if (!phoneId || !apiKeyEnc) {
    return { synced: 0, wabaId: null, source: null };
  }

  const accessToken = decrypt(apiKeyEnc) ?? "";
  if (!accessToken) {
    return { synced: 0, wabaId: null, source: null };
  }

  try {
    let wabaId = creds.whatsappBusinessAccountId?.trim() || null;
    if (!wabaId) {
      wabaId = await fetchWabaIdFromPhoneNumberId(phoneId, accessToken);
    }
    if (!wabaId) {
      log?.warn({ organizationId, source }, "WABA template sync: no business account id");
      return { synced: 0, wabaId: null, source };
    }
    const list = await listApprovedWabaMessageTemplates(wabaId, accessToken);
    const synced = await persistWabaTemplates(organizationId, list);
    return { synced, wabaId, source };
  } catch (err) {
    log?.warn({ err, organizationId, source }, "WABA template sync failed");
    return { synced: 0, wabaId: null, source };
  }
}

/** Sincroniza modelos Meta a partir de uma caixa WhatsApp (credenciais em channelConfig). */
export async function syncWabaTemplatesForInbox(
  organizationId: string,
  inboxId: string,
  log?: FastifyBaseLogger,
): Promise<WabaTemplateSyncResult> {
  const inbox = await prisma.inbox.findFirst({
    where: { id: inboxId, organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { channelConfig: true },
  });
  if (!inbox) return { synced: 0, wabaId: null, source: null };

  const creds = await resolveInboxWhatsappCredentials(organizationId, inbox);
  if (!creds || !isMetaCloudWhatsappProvider(creds.whatsappProvider)) {
    return { synced: 0, wabaId: null, source: null };
  }

  const parsed = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
  return syncFromCredentials(
    organizationId,
    {
      whatsappPhoneNumberId: creds.whatsappPhoneNumberId,
      whatsappApiKey: creds.whatsappApiKey,
      whatsappBusinessAccountId: parsed.whatsappBusinessAccountId ?? null,
    },
    "inbox",
    log,
  );
}

/** Sincroniza modelos para a org: tenta caixas Meta/360dialog e depois Settings legado. */
export async function syncWabaTemplatesForOrganization(
  organizationId: string,
  opts?: { inboxId?: string; log?: FastifyBaseLogger },
): Promise<WabaTemplateSyncResult> {
  if (opts?.inboxId) {
    const one = await syncWabaTemplatesForInbox(organizationId, opts.inboxId, opts.log);
    if (one.synced > 0 || one.wabaId) return one;
  }

  const inboxes = await prisma.inbox.findMany({
    where: { organizationId, channelType: InboxChannelType.WHATSAPP },
    select: { id: true, channelConfig: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  for (const row of inboxes) {
    const parsed = parseInboxWhatsappFromChannelConfig(row.channelConfig);
    if (!isMetaCloudWhatsappProvider(parsed.whatsappProvider)) continue;
    const result = await syncWabaTemplatesForInbox(organizationId, row.id, opts?.log);
    if (result.synced > 0 || result.wabaId) return result;
  }

  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (settings && isMetaCloudWhatsappProvider(settings.whatsappProvider)) {
    return syncFromCredentials(
      organizationId,
      {
        whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
        whatsappApiKey: settings.whatsappApiKey,
      },
      "settings",
      opts?.log,
    );
  }

  return { synced: 0, wabaId: null, source: null };
}
