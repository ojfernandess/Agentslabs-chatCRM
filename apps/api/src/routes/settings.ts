import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { InboxChannelType } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { metaEmbeddedWebhookUrl, webhookUrlForOrganization } from "../config.js";
import { getWhatsAppProvider } from "../providers/factory.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { computeAgentBotTriageActive, getAgentBotDispatchContext, getAgentBotDispatchContextForInbox } from "../lib/agentBotTriage.js";
import {
  evolutionPlatformQrModeActive,
  getEvolutionPlatformConfig,
  isEvolutionQrModeActive,
  resolveEvolutionApiCredentials,
} from "../lib/evolutionPlatform.js";
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

const settingsSchema = z.object({
  whatsappProvider: z.enum(["meta", "360dialog", "twilio", "evolution"]).optional(),
  whatsappApiKey: z.string().max(500).optional(),
  whatsappPhoneNumberId: z.string().max(100).optional(),
  evolutionApiBaseUrl: z.union([z.string().url().max(512), z.literal(""), z.null()]).optional(),
  whatsappWebhookSecret: z.string().max(500).optional(),
  autoOptInOnFirstMessage: z.boolean().optional(),
  notifyConversationOpen: z.boolean().optional(),
  notifyConversationPending: z.boolean().optional(),
  lockSingleConversation: z.boolean().optional(),
  agentBotId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  csatEnabled: z.boolean().optional(),
  csatSurveyMessage: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
  autoResolveConversationsEnabled: z.boolean().optional(),
  autoResolveInactivityMinutes: z.number().int().min(1).max(43_200).optional(),
  autoResolveCustomerMessage: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
  autoResolveSkipWhenAssigned: z.boolean().optional(),
  autoResolveTagId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  autoResolveLeadTypeId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
  resolveRequireClosureReason: z.boolean().optional(),
  resolveRequireLeadType: z.boolean().optional(),
  audioTranscriptionEnabled: z.boolean().optional(),
  silentTransferToAgentBot: z.boolean().optional(),
});

function maskSettings<T extends { whatsappApiKey: string | null; whatsappWebhookSecret: string | null }>(
  settings: T,
  organizationId: string,
) {
  return {
    ...settings,
    whatsappApiKey: settings.whatsappApiKey ? "••••••••" : null,
    whatsappWebhookSecret: settings.whatsappWebhookSecret ? "••••••••" : null,
    webhookUrl: webhookUrlForOrganization(organizationId),
  };
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
      },
    });
    if (!row) {
      await prisma.settings.create({ data: { organizationId } });
      row = { resolveRequireClosureReason: true, resolveRequireLeadType: true };
    }
    return {
      resolveRequireClosureReason: row.resolveRequireClosureReason,
      resolveRequireLeadType: row.resolveRequireLeadType,
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

  /** Dados mínimos do canal para a UI (qualquer utilizador autenticado do tenant). */
  app.get("/channel", { preHandler: [authenticate] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const settings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { whatsappProvider: true },
    });
    const p = settings?.whatsappProvider ?? null;
    const q = request.query as { inboxId?: string };
    let inboxChannelType: InboxChannelType = "WHATSAPP";
    if (q?.inboxId) {
      const inbox = await prisma.inbox.findFirst({
        where: { id: q.inboxId, organizationId },
        select: { channelType: true },
      });
      if (inbox) inboxChannelType = inbox.channelType;
    }
    const agentCtx = q?.inboxId
      ? await getAgentBotDispatchContextForInbox(organizationId, q.inboxId)
      : await getAgentBotDispatchContext(organizationId);
    const agentBotTriageActive = computeAgentBotTriageActive(agentCtx, inboxChannelType);
    return {
      whatsappProvider: p,
      /** Anexos / imagens na conversa — solicitado para Evolution API. */
      evolutionRichChat: p === "evolution",
      /** Há bot de canal configurado e pronto a receber webhooks (fila PENDING). */
      agentBotTriageActive,
      /** Evolution gerida pela plataforma: tenants ligam só por QR (sem URL/chave no browser). */
      evolutionPlatformQrMode: await evolutionPlatformQrModeActive(),
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

      return {
        ...maskSettings(settings, organizationId),
        evolutionPlatformQrMode: await evolutionPlatformQrModeActive(),
      };
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
      const effectiveProvider = (data.whatsappProvider ?? settings?.whatsappProvider) ?? null;
      if (qrMode && effectiveProvider === "evolution") {
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

      return {
        ...maskSettings(settings, organizationId),
        evolutionPlatformQrMode: await evolutionPlatformQrModeActive(),
      };
    });

    admin.post("/test-connection", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      try {
        const provider = await getWhatsAppProvider(organizationId);
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
