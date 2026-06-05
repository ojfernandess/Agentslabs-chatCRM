import { FastifyInstance } from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import type { MultipartFile } from "@fastify/multipart";
import { z } from "zod";
import { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { decrypt, encrypt } from "../lib/encryption.js";
import { metaEmbeddedWebhookUrl, webhookUrlForOrganization } from "../config.js";
import {
  getWhatsAppProvider,
  getWhatsAppProviderForInbox,
  getWhatsAppProviderFromChannelConfig,
  getWhatsappProviderKindForInbox,
} from "../providers/factory.js";
import { prepareWhatsappChannelConfigForSave } from "../lib/inboxWhatsappConfig.js";
import { migrateWhatsappSettingsToDefaultInbox } from "../lib/migrateWhatsappSettingsToInbox.js";
import {
  syncWhatsappCredentialsToInbox,
  syncWhatsappInboxCredentialsToSettings,
} from "../lib/whatsappOrgSync.js";
import {
  generateWhatsappWebhookVerifyToken,
  isMetaCloudWhatsappProvider,
} from "../lib/whatsappWebhookVerify.js";
import { ensureDefaultInboxForOrganization } from "../lib/defaultInbox.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { putMessageMediaFile } from "../lib/mediaStorage.js";
import { getAssistOpenAiCredentialsForOrganization } from "../lib/agentAssistLlm.js";
import { computeAgentBotTriageActive, getAgentBotDispatchContext, getAgentBotDispatchContextForInbox } from "../lib/agentBotTriage.js";
import {
  evolutionGoConnectInstance,
  evolutionGoCreateInstance,
  evolutionGoGetQr,
  evolutionGoRequestPairingCode,
} from "../lib/evolutionGoApi.js";
import {
  evolutionPlatformQrModeActive,
  getEvolutionPlatformConfig,
  isEvolutionQrModeActive,
  resolveEvolutionApiCredentials,
} from "../lib/evolutionPlatform.js";
import {
  ensureEvolutionGoProviderSelected,
  evolutionGoPlatformModeActive,
  evolutionGoScopedInstanceName,
  evolutionGoWebhookUrlForOrganization,
  fetchEvolutionGoInstanceStatus,
  listEvolutionGoInstancesForOrg,
  resolveEvolutionGoApiConnection,
  resolveEvolutionGoOperationAuth,
} from "../lib/evolutionGoPlatform.js";
import {
  evolutionApiCreateInstance,
  evolutionApiFetchConnect,
  evolutionApiFetchConnectionState,
  evolutionApiSetWebhook,
  evolutionConnectJsonToQrPayload,
  evolutionInstanceNameForOrg,
  evolutionInstanceNameWithSuffix,
} from "../lib/evolutionInstanceApi.js";
import {
  exchangeEmbeddedSignupCode,
  exchangeForLongLivedToken,
  fetchFirstPhoneNumberId,
  getWhatsAppEmbeddedConfig,
  getWhatsAppEmbeddedPublicConfig,
  subscribeWabaToApp,
} from "../lib/metaWhatsAppEmbedded.js";

const evolutionQrStartBodySchema = z
  .object({
    instanceName: z.string().optional(),
  })
  .transform((data) => {
    const t = data.instanceName?.trim();
    return { instanceName: t && t.length > 0 ? t : undefined };
  })
  .superRefine((data, ctx) => {
    const s = data.instanceName;
    if (!s) return;
    if (s.length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Instance name must be at least 3 characters, or omit for automatic name",
        path: ["instanceName"],
      });
    }
    if (s.length > 80) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Instance name is too long (max 80)",
        path: ["instanceName"],
      });
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use only letters, numbers, ., _, or - (must start with letter or number)",
        path: ["instanceName"],
      });
    }
  });

const hexColorField = z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal(""), z.null()]).optional();

const settingsSchema = z.object({
  whatsappProvider: z.enum(["meta", "360dialog", "twilio", "evolution", "evolution_go"]).optional(),
  whatsappApiKey: z.string().max(500).optional(),
  whatsappPhoneNumberId: z.string().max(100).optional(),
  evolutionApiBaseUrl: z.union([z.string().url().max(512), z.literal(""), z.null()]).optional(),
  whatsappWebhookSecret: z.string().max(500).optional(),
  /** Guardados na caixa WhatsApp default (channelConfig), não na tabela Settings. */
  whatsappDisplayPhone: z.string().max(32).optional(),
  whatsappBusinessAccountId: z.string().max(64).optional(),
  whatsappRegenerateVerifyToken: z.boolean().optional(),
  autoOptInOnFirstMessage: z.boolean().optional(),
  notifyConversationOpen: z.boolean().optional(),
  notifyConversationPending: z.boolean().optional(),
  lockSingleConversation: z.boolean().optional(),
  agentBotId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  csatEnabled: z.boolean().optional(),
  csatSurveyMessage: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
  csatRatingType: z.enum(["number", "star", "emoji"]).optional(),
  autoResolveConversationsEnabled: z.boolean().optional(),
  autoResolveInactivityMinutes: z.number().int().min(1).max(43_200).optional(),
  autoResolveCustomerMessage: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
  autoResolveSkipWhenAssigned: z.boolean().optional(),
  autoResolveTagId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  autoResolveLeadTypeId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  resolveRequireClosureReason: z.boolean().optional(),
  resolveRequireLeadType: z.boolean().optional(),
  resolveOfferReminder: z.boolean().optional(),
  audioTranscriptionEnabled: z.boolean().optional(),
  imageTranscriptionEnabled: z.boolean().optional(),
  silentTransferToAgentBot: z.boolean().optional(),
  assistantOpenaiApiKey: z.union([z.string().max(500), z.null()]).optional(),
  leadFinderSerpApiKey: z.union([z.string().max(500), z.null()]).optional(),
  assistantOpenaiApiBaseUrl: z.union([z.string().url().max(512), z.literal(""), z.null()]).optional(),
  assistantAiEnabled: z.boolean().optional(),
  aiPilotAccessEnabled: z.boolean().optional(),
  aiAlertWebhookUrl: z.union([z.string().url().max(2048), z.literal(""), z.null()]).optional(),
  aiAlertWebhookSecret: z.union([z.string().max(500), z.null()]).optional(),
  conversationsAttendanceTabEnabled: z.boolean().optional(),
  conversationsAttendanceTabAutoOpen: z.boolean().optional(),
  conversationsListShowContactTags: z.boolean().optional(),
  conversationBubbleClientColor: hexColorField,
  conversationBubbleAgentColor: hexColorField,
  conversationBubbleClientColorDark: hexColorField,
  conversationBubbleAgentColorDark: hexColorField,
  conversationBubbleClientTextColor: hexColorField,
  conversationBubbleAgentTextColor: hexColorField,
  conversationBubbleClientTextColorDark: hexColorField,
  conversationBubbleAgentTextColorDark: hexColorField,
  conversationBubbleAgentNameColor: hexColorField,
  conversationBubbleAgentNameColorDark: hexColorField,
  conversationBubbleClientMetaColor: hexColorField,
  conversationBubbleClientMetaColorDark: hexColorField,
  conversationBubbleAgentMetaColor: hexColorField,
  conversationBubbleAgentMetaColorDark: hexColorField,
  organizationLogoUrl: z.union([z.string().url().max(2048), z.literal(""), z.null()]).optional(),
});

function maskSettings<
  T extends {
    whatsappApiKey: string | null;
    whatsappWebhookSecret: string | null;
    assistantOpenaiApiKey?: string | null;
    leadFinderSerpApiKey?: string | null;
    assistantOpenaiApiBaseUrl?: string | null;
    aiAlertWebhookSecret?: string | null;
    assistantAiEnabled?: boolean;
    aiPilotAccessEnabled?: boolean;
  },
>(settings: T, organizationId: string) {
  return {
    ...settings,
    whatsappApiKey: settings.whatsappApiKey ? "••••••••" : null,
    whatsappWebhookSecret: settings.whatsappWebhookSecret ? "••••••••" : null,
    whatsappWebhookVerifyToken:
      "whatsappWebhookVerifyToken" in settings
        ? (settings as { whatsappWebhookVerifyToken?: string | null }).whatsappWebhookVerifyToken ?? null
        : null,
    assistantOpenaiApiKey: settings.assistantOpenaiApiKey ? "••••••••" : null,
    leadFinderSerpApiKey: settings.leadFinderSerpApiKey ? "••••••••" : null,
    aiAlertWebhookSecret: settings.aiAlertWebhookSecret ? "••••••••" : null,
    webhookUrl: webhookUrlForOrganization(organizationId),
  };
}

async function ensureWhatsappWebhookVerifyToken(
  settings: { id: string; whatsappProvider: string | null; whatsappWebhookVerifyToken: string | null },
): Promise<{ whatsappProvider: string | null; whatsappWebhookVerifyToken: string | null }> {
  if (!isMetaCloudWhatsappProvider(settings.whatsappProvider) || settings.whatsappWebhookVerifyToken) {
    return settings;
  }
  return prisma.settings.update({
    where: { id: settings.id },
    data: { whatsappWebhookVerifyToken: generateWhatsappWebhookVerifyToken() },
    select: { whatsappProvider: true, whatsappWebhookVerifyToken: true },
  });
}

function allowOrganizationLogoUpload(mime: string): boolean {
  const m = mime.split(";")[0].trim().toLowerCase();
  return (
    m === "image/png" ||
    m === "image/jpeg" ||
    m === "image/jpg" ||
    m === "image/webp" ||
    m === "image/gif" ||
    m === "image/svg+xml"
  );
}

function logoExtensionForMime(mime: string, originalFilename?: string): string {
  const m = mime.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  if (map[m]) return map[m];
  const ext = originalFilename?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "png";
}

async function persistOrganizationLogoUpload(
  file: MultipartFile,
  reply: import("fastify").FastifyReply,
): Promise<string | null> {
  const rawMime = file.mimetype ?? "";
  if (!allowOrganizationLogoUpload(rawMime)) {
    await reply.status(415).send({
      error: "Unsupported Media Type",
      message: "Allowed: PNG, JPEG, WebP, GIF or SVG",
      statusCode: 415,
    });
    return null;
  }
  const mime = rawMime.split(";")[0].trim().toLowerCase();
  const buf = await file.toBuffer();
  if (buf.length > 2 * 1024 * 1024) {
    await reply.status(413).send({
      error: "Payload Too Large",
      message: "Logo must be 2 MB or smaller",
      statusCode: 413,
    });
    return null;
  }
  const ext = logoExtensionForMime(rawMime, file.filename ?? undefined);
  const filename = `${randomBytes(16).toString("hex")}.${ext}`;
  const stored = await putMessageMediaFile({
    filename,
    buffer: buf,
    contentType: mime || "application/octet-stream",
  });
  return stored.mediaUrl;
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  /** Regras de finalização manual (motivo / tipo de lead) para a UI da conversa. */
  app.get("/conversation-workflow", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    let row = await prisma.settings.findUnique({
      where: { organizationId },
      select: {
        resolveRequireClosureReason: true,
        resolveRequireLeadType: true,
        resolveOfferReminder: true,
      },
    });
    if (!row) {
      await prisma.settings.create({ data: { organizationId } });
      row = { resolveRequireClosureReason: true, resolveRequireLeadType: true, resolveOfferReminder: true };
    }
    return {
      resolveRequireClosureReason: row.resolveRequireClosureReason,
      resolveRequireLeadType: row.resolveRequireLeadType,
      resolveOfferReminder: row.resolveOfferReminder,
    };
  });

  app.get("/notifications", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    let settings = await prisma.settings.findUnique({ where: { organizationId } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { organizationId } });
    }
    return {
      notifyConversationOpen: settings.notifyConversationOpen,
      notifyConversationPending: settings.notifyConversationPending,
    };
  });

  /** Cores dos balões de conversa — qualquer utilizador autenticado do tenant. */
  app.get("/conversation-appearance", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const settings = await prisma.settings.findUnique({
      where: { organizationId },
      select: {
        conversationBubbleClientColor: true,
        conversationBubbleAgentColor: true,
        conversationBubbleClientColorDark: true,
        conversationBubbleAgentColorDark: true,
        conversationBubbleClientTextColor: true,
        conversationBubbleAgentTextColor: true,
        conversationBubbleClientTextColorDark: true,
        conversationBubbleAgentTextColorDark: true,
        conversationBubbleAgentNameColor: true,
        conversationBubbleAgentNameColorDark: true,
        conversationBubbleClientMetaColor: true,
        conversationBubbleClientMetaColorDark: true,
        conversationBubbleAgentMetaColor: true,
        conversationBubbleAgentMetaColorDark: true,
      },
    });

    return {
      conversationBubbleClientColor: settings?.conversationBubbleClientColor ?? null,
      conversationBubbleAgentColor: settings?.conversationBubbleAgentColor ?? null,
      conversationBubbleClientColorDark: settings?.conversationBubbleClientColorDark ?? null,
      conversationBubbleAgentColorDark: settings?.conversationBubbleAgentColorDark ?? null,
      conversationBubbleClientTextColor: settings?.conversationBubbleClientTextColor ?? null,
      conversationBubbleAgentTextColor: settings?.conversationBubbleAgentTextColor ?? null,
      conversationBubbleClientTextColorDark: settings?.conversationBubbleClientTextColorDark ?? null,
      conversationBubbleAgentTextColorDark: settings?.conversationBubbleAgentTextColorDark ?? null,
      conversationBubbleAgentNameColor: settings?.conversationBubbleAgentNameColor ?? null,
      conversationBubbleAgentNameColorDark: settings?.conversationBubbleAgentNameColorDark ?? null,
      conversationBubbleClientMetaColor: settings?.conversationBubbleClientMetaColor ?? null,
      conversationBubbleClientMetaColorDark: settings?.conversationBubbleClientMetaColorDark ?? null,
      conversationBubbleAgentMetaColor: settings?.conversationBubbleAgentMetaColor ?? null,
      conversationBubbleAgentMetaColorDark: settings?.conversationBubbleAgentMetaColorDark ?? null,
    };
  });

  /** Logo opcional da organização — qualquer utilizador autenticado do tenant. */
  app.get("/branding", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const settings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { organizationLogoUrl: true },
    });

    return {
      organizationLogoUrl: settings?.organizationLogoUrl ?? null,
    };
  });

  /** Dados mínimos do canal para a UI (qualquer utilizador autenticado do tenant). */
  app.get("/channel", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const settings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { whatsappProvider: true },
    });
    const q = request.query as { inboxId?: string };
    let p = settings?.whatsappProvider ?? null;
    let inboxChannelType: InboxChannelType = "WHATSAPP";
    if (q?.inboxId) {
      const inbox = await prisma.inbox.findFirst({
        where: { id: q.inboxId, organizationId },
        select: { channelType: true },
      });
      if (inbox) inboxChannelType = inbox.channelType;
      const inboxProvider = await getWhatsappProviderKindForInbox(organizationId, q.inboxId);
      if (inboxProvider) p = inboxProvider;
    }
    let richChatProvider = p;
    if (q?.inboxId) {
      const inboxProvider = await getWhatsappProviderKindForInbox(organizationId, q.inboxId);
      if (inboxProvider) richChatProvider = inboxProvider;
    }
    const agentCtx = q?.inboxId
      ? await getAgentBotDispatchContextForInbox(organizationId, q.inboxId)
      : await getAgentBotDispatchContext(organizationId);
    const agentBotTriageActive = computeAgentBotTriageActive(agentCtx, inboxChannelType);
    const orgSettings = await prisma.settings.findUnique({
      where: { organizationId },
      select: {
        conversationsAttendanceTabEnabled: true,
        conversationsAttendanceTabAutoOpen: true,
        conversationsListShowContactTags: true,
      },
    });
    return {
      whatsappProvider: p,
      /** Anexos / imagens / áudio na conversa (Evolution, Meta Cloud API, 360dialog). */
      evolutionRichChat:
        richChatProvider === "evolution" ||
        richChatProvider === "evolution_go" ||
        richChatProvider === "meta" ||
        richChatProvider === "360dialog",
      /** Há bot de canal configurado e pronto a receber webhooks (fila PENDING). */
      agentBotTriageActive,
      /** Aba «Atendimento» activa em Conversas (OPEN à espera de agente). */
      conversationsAttendanceTabEnabled: orgSettings?.conversationsAttendanceTabEnabled ?? false,
      conversationsAttendanceTabAutoOpen: orgSettings?.conversationsAttendanceTabAutoOpen ?? true,
      conversationsListShowContactTags: orgSettings?.conversationsListShowContactTags ?? false,
      /** Evolution gerida pela plataforma: tenants ligam só por QR (sem URL/chave no browser). */
      evolutionPlatformQrMode: await evolutionPlatformQrModeActive(),
      /** Evolution Go gerida pela plataforma: tenants usam credenciais globais e guardam apenas instanceId. */
      evolutionGoPlatformMode: await evolutionGoPlatformModeActive(),
    };
  });

  app.get("/pilot", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    let settings = await prisma.settings.findUnique({ where: { organizationId } });
    if (!settings) {
      settings = await prisma.settings.create({ data: { organizationId } });
    }

    const openAiConfigured = !!(await getAssistOpenAiCredentialsForOrganization(organizationId));

    return {
      assistantAiEnabled: settings.assistantAiEnabled,
      aiPilotAccessEnabled: settings.aiPilotAccessEnabled,
      openAiConfigured,
    };
  });

  await app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.get("/", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      let settings = await prisma.settings.findUnique({ where: { organizationId } });
      if (!settings) {
        settings = await prisma.settings.create({ data: { organizationId } });
      }
      if (isMetaCloudWhatsappProvider(settings.whatsappProvider)) {
        const ensured = await ensureWhatsappWebhookVerifyToken(settings);
        settings = { ...settings, ...ensured };
      }

      return {
        ...maskSettings(settings, organizationId),
        evolutionPlatformQrMode: await evolutionPlatformQrModeActive(),
        evolutionGoPlatformMode: await evolutionGoPlatformModeActive(),
      };
    });

    admin.post("/organization-logo", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const file = await request.file({ limits: { fileSize: 2 * 1024 * 1024 } });
      if (!file) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "multipart file field required",
          statusCode: 400,
        });
      }

      const mediaUrl = await persistOrganizationLogoUpload(file, reply);
      if (!mediaUrl) return;

      let settings = await prisma.settings.findUnique({ where: { organizationId } });
      if (!settings) {
        settings = await prisma.settings.create({
          data: { organizationId, organizationLogoUrl: mediaUrl },
        });
      } else {
        settings = await prisma.settings.update({
          where: { organizationId },
          data: { organizationLogoUrl: mediaUrl },
        });
      }

      return { organizationLogoUrl: settings.organizationLogoUrl };
    });

    admin.put("/", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      let settings = await prisma.settings.findUnique({ where: { organizationId } });
      const data = { ...parsed.data } as Record<string, unknown>;
      if (data.evolutionApiBaseUrl === "") data.evolutionApiBaseUrl = null;
      if (data.agentBotId === "") data.agentBotId = null;
      if (data.csatSurveyMessage === "") data.csatSurveyMessage = null;
      if (data.autoResolveCustomerMessage === "") data.autoResolveCustomerMessage = null;
      if (data.autoResolveTagId === "") data.autoResolveTagId = null;
      if (data.autoResolveLeadTypeId === "") data.autoResolveLeadTypeId = null;
      if (data.assistantOpenaiApiBaseUrl === "") data.assistantOpenaiApiBaseUrl = null;
      if (data.conversationBubbleClientColor === "") data.conversationBubbleClientColor = null;
      if (data.conversationBubbleAgentColor === "") data.conversationBubbleAgentColor = null;
      if (data.conversationBubbleClientColorDark === "") data.conversationBubbleClientColorDark = null;
      if (data.conversationBubbleAgentColorDark === "") data.conversationBubbleAgentColorDark = null;
      if (data.conversationBubbleClientTextColor === "") data.conversationBubbleClientTextColor = null;
      if (data.conversationBubbleAgentTextColor === "") data.conversationBubbleAgentTextColor = null;
      if (data.conversationBubbleClientTextColorDark === "") data.conversationBubbleClientTextColorDark = null;
      if (data.conversationBubbleAgentTextColorDark === "") data.conversationBubbleAgentTextColorDark = null;
      if (data.conversationBubbleAgentNameColor === "") data.conversationBubbleAgentNameColor = null;
      if (data.conversationBubbleAgentNameColorDark === "") data.conversationBubbleAgentNameColorDark = null;
      if (data.conversationBubbleClientMetaColor === "") data.conversationBubbleClientMetaColor = null;
      if (data.conversationBubbleClientMetaColorDark === "") data.conversationBubbleClientMetaColorDark = null;
      if (data.conversationBubbleAgentMetaColor === "") data.conversationBubbleAgentMetaColor = null;
      if (data.conversationBubbleAgentMetaColorDark === "") data.conversationBubbleAgentMetaColorDark = null;
      if (data.organizationLogoUrl === "") data.organizationLogoUrl = null;

      if (data.whatsappApiKey !== undefined && typeof data.whatsappApiKey === "string") {
        const t = data.whatsappApiKey.trim();
        if (t && t !== "••••••••" && t !== "***") {
          data.whatsappApiKey = encrypt(t);
        } else {
          delete data.whatsappApiKey;
        }
      }

      if (data.whatsappWebhookSecret !== undefined && typeof data.whatsappWebhookSecret === "string") {
        const t = data.whatsappWebhookSecret.trim();
        if (t && t !== "••••••••" && t !== "***") {
          data.whatsappWebhookSecret = encrypt(t);
        } else {
          delete data.whatsappWebhookSecret;
        }
      }

      if (data.assistantOpenaiApiKey !== undefined) {
        const raw = data.assistantOpenaiApiKey;
        if (raw === null) {
          /* explicit clear */
        } else if (typeof raw === "string") {
          const t = raw.trim();
          if (!t || t === "••••••••" || t === "***") {
            delete data.assistantOpenaiApiKey;
          } else {
            data.assistantOpenaiApiKey = encrypt(t.slice(0, 500));
          }
        }
      }

      if (data.leadFinderSerpApiKey !== undefined) {
        const raw = data.leadFinderSerpApiKey;
        if (raw === null) {
          /* explicit clear */
        } else if (typeof raw === "string") {
          const t = raw.trim();
          if (!t || t === "••••••••" || t === "***") {
            delete data.leadFinderSerpApiKey;
          } else {
            data.leadFinderSerpApiKey = encrypt(t.slice(0, 500));
          }
        }
      }

      if (data.aiAlertWebhookSecret !== undefined) {
        const raw = data.aiAlertWebhookSecret;
        if (raw === null) {
          /* clear */
        } else if (typeof raw === "string") {
          const t = raw.trim();
          if (!t || t === "••••••••" || t === "***") {
            delete data.aiAlertWebhookSecret;
          } else {
            data.aiAlertWebhookSecret = encrypt(t.slice(0, 500));
          }
        }
      }

      const mergedAutoEnabled =
        (data.autoResolveConversationsEnabled as boolean | undefined) ??
        settings?.autoResolveConversationsEnabled ??
        false;
      const mergedAutoLeadTypeId =
        (data.autoResolveLeadTypeId as string | null | undefined) ?? settings?.autoResolveLeadTypeId ?? null;
      if (mergedAutoEnabled && !mergedAutoLeadTypeId) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "autoResolveLeadTypeId is required when automatic conversation resolution is enabled",
          statusCode: 400,
        });
      }

      if (data.autoResolveTagId) {
        const tagOk = await prisma.tag.findFirst({
          where: { id: data.autoResolveTagId as string, organizationId },
        });
        if (!tagOk) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid autoResolveTagId", statusCode: 400 });
        }
      }
      if (data.autoResolveLeadTypeId) {
        const ltOk = await prisma.leadType.findFirst({
          where: { id: data.autoResolveLeadTypeId as string, organizationId },
        });
        if (!ltOk) {
          return reply
            .status(400)
            .send({ error: "Bad Request", message: "Invalid autoResolveLeadTypeId", statusCode: 400 });
        }
      }

      const qrMode = await evolutionPlatformQrModeActive();
      const goPlatformMode = await evolutionGoPlatformModeActive();
      const effectiveProvider: string | null =
        typeof data.whatsappProvider === "string"
          ? data.whatsappProvider
          : (settings?.whatsappProvider ?? null);
      if ((qrMode && effectiveProvider === "evolution") || (goPlatformMode && effectiveProvider === "evolution_go")) {
        delete data.evolutionApiBaseUrl;
        delete data.whatsappApiKey;
      }

      if (data.agentBotId) {
        const botOk = await prisma.bot.findFirst({
          where: { id: data.agentBotId as string, organizationId },
        });
        if (!botOk) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid agentBotId for this organization", statusCode: 400 });
        }
      }

      const inboxDisplayPhone =
        typeof data.whatsappDisplayPhone === "string" ? data.whatsappDisplayPhone.trim() : undefined;
      const inboxWabaId =
        typeof data.whatsappBusinessAccountId === "string" ? data.whatsappBusinessAccountId.trim() : undefined;
      delete data.whatsappDisplayPhone;
      delete data.whatsappBusinessAccountId;

      const regenerateVerify = data.whatsappRegenerateVerifyToken === true;
      delete data.whatsappRegenerateVerifyToken;
      if (regenerateVerify && isMetaCloudWhatsappProvider(effectiveProvider)) {
        data.whatsappWebhookVerifyToken = generateWhatsappWebhookVerifyToken();
      } else if (
        isMetaCloudWhatsappProvider(effectiveProvider) &&
        !settings?.whatsappWebhookVerifyToken
      ) {
        data.whatsappWebhookVerifyToken = generateWhatsappWebhookVerifyToken();
      }

      if (!settings) {
        settings = await prisma.settings.create({
          data: { organizationId, ...(data as typeof parsed.data) },
        });
      } else {
        settings = await prisma.settings.update({
          where: { id: settings.id },
          data: data as typeof parsed.data,
        });
      }
      if (isMetaCloudWhatsappProvider(settings.whatsappProvider) && !settings.whatsappWebhookVerifyToken) {
        settings = await prisma.settings.update({
          where: { id: settings.id },
          data: { whatsappWebhookVerifyToken: generateWhatsappWebhookVerifyToken() },
        });
      }

      if (settings.whatsappProvider?.trim()) {
        await ensureDefaultInboxForOrganization(organizationId);
        try {
          const synced = await syncWhatsappCredentialsToInbox(organizationId, {
            whatsappProvider: settings.whatsappProvider,
            whatsappPhoneNumberId: settings.whatsappPhoneNumberId ?? undefined,
            whatsappApiKey: settings.whatsappApiKey ?? undefined,
            whatsappWebhookSecret: settings.whatsappWebhookSecret ?? undefined,
            evolutionApiBaseUrl: settings.evolutionApiBaseUrl ?? undefined,
            whatsappDisplayPhone: inboxDisplayPhone,
            whatsappBusinessAccountId: inboxWabaId,
          });
          if (synced) {
            await syncWhatsappInboxCredentialsToSettings(organizationId, synced.inboxId);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "WhatsApp inbox sync failed";
          return reply.status(409).send({ error: "Conflict", message: msg, statusCode: 409 });
        }
      }

      return {
        ...maskSettings(settings, organizationId),
        evolutionPlatformQrMode: await evolutionPlatformQrModeActive(),
        evolutionGoPlatformMode: await evolutionGoPlatformModeActive(),
      };
    });

    admin.post("/test-whatsapp-draft", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = z
        .object({
          channelConfig: z.record(z.unknown()),
          /** Mescla segredos gravados na caixa quando o cliente envia placeholder mascarado. */
          inboxId: z.string().uuid().optional(),
        })
        .safeParse(request.body ?? {});
      if (!parsed.success || !parsed.data.channelConfig) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "channelConfig required",
          statusCode: 400,
        });
      }

      let existingConfig: unknown = null;
      if (parsed.data.inboxId) {
        const inbox = await prisma.inbox.findFirst({
          where: { id: parsed.data.inboxId, organizationId, channelType: InboxChannelType.WHATSAPP },
          select: { channelConfig: true },
        });
        if (!inbox) {
          return reply.status(404).send({
            error: "Not Found",
            message: "WhatsApp inbox not found",
            statusCode: 404,
          });
        }
        existingConfig = inbox.channelConfig;
      }

      const prepared = prepareWhatsappChannelConfigForSave({
        existingConfig,
        incoming: parsed.data.channelConfig,
        ensureMetaVerifyToken: false,
      });
      const provider = await getWhatsAppProviderFromChannelConfig(prepared);
      if (!provider) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "WhatsApp provider credentials incomplete",
          statusCode: 400,
          connected: false,
        });
      }
      try {
        const connected = await provider.healthCheck();
        return { connected };
      } catch {
        return { connected: false };
      }
    });

    admin.post("/test-connection", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const q = request.query as { inboxId?: string };
      try {
        const provider = q.inboxId
          ? await getWhatsAppProviderForInbox(organizationId, q.inboxId)
          : await getWhatsAppProvider(organizationId);
        if (!provider) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "WhatsApp provider not configured",
            statusCode: 400,
          });
        }
        const healthy = await provider.healthCheck();
        return { connected: healthy };
      } catch {
        return { connected: false };
      }
    });

    admin.get("/evolution-go/instances", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const settings = await ensureEvolutionGoProviderSelected(organizationId);
      if (!settings) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go provider not selected",
          statusCode: 400,
        });
      }
      const api = await resolveEvolutionGoApiConnection(settings);
      if (!api) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go base URL / API key not configured",
          statusCode: 400,
        });
      }
      const selected = settings.whatsappPhoneNumberId?.trim() ?? "";
      const orgInstances = await listEvolutionGoInstancesForOrg(organizationId, selected || undefined);
      if (!orgInstances) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: "Failed to fetch Evolution Go instances",
          statusCode: 502,
        });
      }
      return {
        selectedInstance: selected || null,
        instances: orgInstances.map((x) => ({
          ...x,
          selected: !!selected && (x.name === selected || x.id === selected),
        })),
      };
    });

    admin.post("/evolution-go/connect", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const settings = await ensureEvolutionGoProviderSelected(organizationId);
      if (!settings) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go provider not selected",
          statusCode: 400,
        });
      }
      const instanceRef = settings.whatsappPhoneNumberId?.trim() ?? "";
      if (!instanceRef) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Create or select an Evolution Go instance first",
          statusCode: 400,
        });
      }
      const auth = await resolveEvolutionGoOperationAuth(settings, organizationId);
      if (!auth) {
        return reply.status(400).send({
          error: "Bad Request",
          message:
            "Instance token missing. Create the instance again or re-select it from your organization instances.",
          statusCode: 400,
        });
      }
      const webhookUrl = await evolutionGoWebhookUrlForOrganization(organizationId);
      const connectRes = await evolutionGoConnectInstance({
        baseUrl: auth.baseUrl,
        apiKey: auth.apiKey,
        webhookUrl,
      });
      if (!connectRes.ok) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: connectRes.hint ?? "Evolution Go connect failed",
          statusCode: 502,
          upstreamStatus: connectRes.status,
        });
      }
      await syncWhatsappCredentialsToInbox(organizationId, {
        whatsappProvider: "evolution_go",
        whatsappPhoneNumberId: instanceRef,
        whatsappApiKey: settings.whatsappApiKey ?? undefined,
        evolutionApiBaseUrl: settings.evolutionApiBaseUrl ?? undefined,
      }).catch(() => {});
      return { connected: true, webhookUrl };
    });

    const evolutionGoCreateSchema = z.object({
      name: z.string().min(3).max(80),
    });

    admin.post("/evolution-go/create", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = evolutionGoCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const settings = await ensureEvolutionGoProviderSelected(organizationId);
      if (!settings) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go provider not selected — save Evolution Go as the WhatsApp provider first",
          statusCode: 400,
        });
      }
      const api = await resolveEvolutionGoApiConnection(settings);
      if (!api) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go base URL / API key not configured",
          statusCode: 400,
        });
      }
      const token = randomUUID();
      const instanceName = evolutionGoScopedInstanceName(organizationId, parsed.data.name.trim());
      const created = await evolutionGoCreateInstance({
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        name: instanceName,
        token,
      });
      if (!created) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: "Evolution Go create instance failed",
          statusCode: 502,
        });
      }

      const updated = await prisma.settings.update({
        where: { organizationId },
        data: {
          whatsappProvider: "evolution_go",
          whatsappPhoneNumberId: created.id,
          whatsappApiKey: encrypt(created.token),
        },
      });
      const webhookUrl = await evolutionGoWebhookUrlForOrganization(organizationId);
      const connectRes = await evolutionGoConnectInstance({
        baseUrl: api.baseUrl,
        apiKey: created.token,
        webhookUrl,
      });
      if (connectRes.ok) {
        await syncWhatsappCredentialsToInbox(organizationId, {
          whatsappProvider: "evolution_go",
          whatsappPhoneNumberId: created.id,
          whatsappApiKey: updated.whatsappApiKey ?? undefined,
          evolutionApiBaseUrl: updated.evolutionApiBaseUrl ?? undefined,
        }).catch(() => {});
      }
      return {
        instance: {
          id: created.id,
          name: created.name,
          connected: false,
          webhookConfigured: connectRes.ok,
        },
      };
    });

    admin.get("/evolution-go/qr", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const settings = await ensureEvolutionGoProviderSelected(organizationId);
      if (!settings) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go provider not selected",
          statusCode: 400,
        });
      }
      if (!settings.whatsappPhoneNumberId?.trim()) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Create an Evolution Go instance first",
          statusCode: 400,
        });
      }
      const auth = await resolveEvolutionGoOperationAuth(settings, organizationId);
      if (!auth) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Instance token missing — recreate the instance",
          statusCode: 400,
        });
      }
      const qr = await evolutionGoGetQr({ baseUrl: auth.baseUrl, apiKey: auth.apiKey });
      if (!qr) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: "Evolution Go get QR failed — connect webhook first or wait if already logged in",
          statusCode: 502,
        });
      }
      return { qrDataUrl: qr.qrDataUrl, code: qr.code };
    });

    admin.get("/evolution-go/status", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const settings = await ensureEvolutionGoProviderSelected(organizationId);
      if (!settings) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go provider not selected",
          statusCode: 400,
        });
      }
      const instanceRef = settings.whatsappPhoneNumberId?.trim() ?? "";
      if (!instanceRef) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go instance not configured",
          statusCode: 400,
        });
      }
      return fetchEvolutionGoInstanceStatus(settings, organizationId);
    });

    const evolutionGoPairSchema = z.object({
      phone: z.string().min(8).max(32),
    });

    admin.post("/evolution-go/pair", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = evolutionGoPairSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const settings = await ensureEvolutionGoProviderSelected(organizationId);
      if (!settings) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Evolution Go provider not selected",
          statusCode: 400,
        });
      }
      const auth = await resolveEvolutionGoOperationAuth(settings, organizationId);
      if (!auth) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Instance token missing — create the instance first",
          statusCode: 400,
        });
      }
      const code = await evolutionGoRequestPairingCode({
        baseUrl: auth.baseUrl,
        apiKey: auth.apiKey,
        phone: parsed.data.phone.trim(),
      });
      if (!code) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: "Evolution Go pairing code failed",
          statusCode: 502,
        });
      }
      return { pairingCode: code };
    });

    admin.get("/whatsapp-embedded", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const pub = await getWhatsAppEmbeddedPublicConfig();
      return {
        available: !!pub,
        appId: pub?.appId ?? null,
        configurationId: pub?.configurationId ?? null,
        apiVersion: pub?.apiVersion ?? null,
        metaWebhookCallbackUrl: metaEmbeddedWebhookUrl(),
        orgWebhookUrl: webhookUrlForOrganization(organizationId),
      };
    });

    const embeddedCompleteSchema = z.object({
      code: z.string().min(1),
      business_id: z.string().min(1),
      waba_id: z.string().min(1),
      phone_number_id: z.string().optional(),
    });

    admin.post("/whatsapp-embedded/complete", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const parsed = embeddedCompleteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }
      const cfg = await getWhatsAppEmbeddedConfig();
      if (!cfg) {
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "WhatsApp Embedded is not configured by the platform administrator.",
          statusCode: 503,
        });
      }
      try {
        let access = await exchangeEmbeddedSignupCode(parsed.data.code, cfg);
        access = await exchangeForLongLivedToken(access, cfg);
        await subscribeWabaToApp(parsed.data.waba_id, access, cfg);
        let phoneId = parsed.data.phone_number_id?.trim() ?? "";
        if (!phoneId) {
          phoneId = (await fetchFirstPhoneNumberId(parsed.data.waba_id, access, cfg)) ?? "";
        }
        if (!phoneId) {
          return reply.status(400).send({
            error: "Bad Request",
            message:
              "Could not determine phone_number_id. Finish number setup in Meta or retry the embedded flow.",
            statusCode: 400,
          });
        }
        let settings = await prisma.settings.findUnique({ where: { organizationId } });
        const data = {
          whatsappProvider: "meta" as const,
          whatsappApiKey: access,
          whatsappPhoneNumberId: phoneId,
          evolutionApiBaseUrl: null,
        };
        if (!settings) {
          settings = await prisma.settings.create({ data: { organizationId, ...data } });
        } else {
          settings = await prisma.settings.update({
            where: { id: settings.id },
            data,
          });
        }
        return {
          ok: true,
          whatsappProvider: settings.whatsappProvider,
          whatsappPhoneNumberId: settings.whatsappPhoneNumberId,
          metaWebhookCallbackUrl: metaEmbeddedWebhookUrl(),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Embedded signup failed";
        return reply.status(400).send({ error: "Bad Request", message: msg, statusCode: 400 });
      }
    });

    admin.post("/evolution-qr/start", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const platform = await getEvolutionPlatformConfig();
      if (!isEvolutionQrModeActive(platform)) {
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "Evolution QR-managed mode is not enabled on this platform.",
          statusCode: 503,
        });
      }

      const parsedStart = evolutionQrStartBodySchema.safeParse(request.body ?? {});
      if (!parsedStart.success) {
        const first = parsedStart.error.issues[0];
        return reply.status(400).send({
          error: "Bad Request",
          message: first?.message ?? parsedStart.error.message,
          statusCode: 400,
        });
      }

      let settings = await prisma.settings.findUnique({ where: { organizationId } });
      if (!settings) {
        settings = await prisma.settings.create({ data: { organizationId } });
      }

      const webhookUrl = webhookUrlForOrganization(organizationId);
      const secret = settings.whatsappWebhookSecret?.trim();
      const webhookHeaders = secret ? { "x-openconduit-token": secret } : undefined;

      const apiKey = platform.globalApiKey.trim();
      const baseUrl = platform.baseUrl.trim();

      const requestedName = parsedStart.data.instanceName;
      let instanceName = requestedName ?? evolutionInstanceNameForOrg(organizationId);

      let createRes = await evolutionApiCreateInstance({
        baseUrl,
        apiKey,
        instanceName,
        webhookUrl,
        webhookHeaders,
      });

      if (!createRes.ok) {
        if (createRes.status === 403 || createRes.status === 409) {
          const connectExisting = await evolutionApiFetchConnect(baseUrl, apiKey, instanceName);
          if (!connectExisting.ok) {
            instanceName = evolutionInstanceNameWithSuffix(instanceName);
            createRes = await evolutionApiCreateInstance({
              baseUrl,
              apiKey,
              instanceName,
              webhookUrl,
              webhookHeaders,
            });
            if (!createRes.ok) {
              return reply.status(502).send({
                error: "Bad Gateway",
                message: `Evolution instance/create: ${createRes.status} ${createRes.body.slice(0, 500)}`,
                statusCode: 502,
              });
            }
          }
        } else {
          return reply.status(502).send({
            error: "Bad Gateway",
            message: `Evolution instance/create: ${createRes.status} ${createRes.body.slice(0, 500)}`,
            statusCode: 502,
          });
        }
      }

      const setWh = await evolutionApiSetWebhook({
        baseUrl,
        apiKey,
        instanceName,
        webhookUrl,
        webhookHeaders,
      });
      if (!setWh.ok) {
        request.log.warn(
          { status: setWh.status, instanceName, body: setWh.body.slice(0, 400) },
          "Evolution POST /webhook/set failed after instance/create",
        );
      }

      await prisma.settings.update({
        where: { organizationId },
        data: {
          whatsappProvider: "evolution",
          whatsappPhoneNumberId: instanceName,
          evolutionApiBaseUrl: null,
          whatsappApiKey: null,
        },
      });

      const conn = await evolutionApiFetchConnect(baseUrl, apiKey, instanceName);
      if (!conn.ok) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: `Evolution instance/connect: ${conn.status} ${conn.body.slice(0, 500)}`,
          statusCode: 502,
        });
      }

      const qr = await evolutionConnectJsonToQrPayload(conn.raw);
      const st = await evolutionApiFetchConnectionState(baseUrl, apiKey, instanceName);

      return {
        instanceName,
        pairingCode: qr.pairingCode,
        qrDataUrl: qr.qrDataUrl,
        connectionState: st?.state ?? "",
        connected: (st?.state ?? "").toLowerCase() === "open",
        webhookConfigured: setWh.ok,
      };
    });

    admin.get("/evolution-qr/qr", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const platform = await getEvolutionPlatformConfig();
      if (!isEvolutionQrModeActive(platform)) {
        return reply.status(503).send({
          error: "Service Unavailable",
          message: "Evolution QR-managed mode is not enabled on this platform.",
          statusCode: 503,
        });
      }

      const settings = await prisma.settings.findUnique({ where: { organizationId } });
      if (settings?.whatsappProvider !== "evolution" || !settings.whatsappPhoneNumberId?.trim()) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Start the Evolution QR flow first.",
          statusCode: 400,
        });
      }

      const creds = await resolveEvolutionApiCredentials(settings);
      if (!creds) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Could not resolve Evolution credentials.",
          statusCode: 400,
        });
      }

      const conn = await evolutionApiFetchConnect(creds.baseUrl, creds.apiKey, creds.instanceName);
      if (!conn.ok) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: `Evolution instance/connect: ${conn.status} ${conn.body.slice(0, 500)}`,
          statusCode: 502,
        });
      }
      const qr = await evolutionConnectJsonToQrPayload(conn.raw);
      return {
        instanceName: creds.instanceName,
        pairingCode: qr.pairingCode,
        qrDataUrl: qr.qrDataUrl,
      };
    });

    admin.get("/evolution-qr/status", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const settings = await prisma.settings.findUnique({ where: { organizationId } });
      if (settings?.whatsappProvider !== "evolution") {
        return { connected: false, state: "", instanceName: settings?.whatsappPhoneNumberId ?? "" };
      }

      const creds = await resolveEvolutionApiCredentials(settings);
      if (!creds) {
        return {
          connected: false,
          state: "",
          instanceName: settings.whatsappPhoneNumberId ?? "",
        };
      }

      const st = await evolutionApiFetchConnectionState(creds.baseUrl, creds.apiKey, creds.instanceName);
      const state = st?.state ?? "";
      return {
        connected: state.toLowerCase() === "open",
        state,
        instanceName: creds.instanceName,
      };
    });
  });
}
