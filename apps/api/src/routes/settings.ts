import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { metaEmbeddedWebhookUrl, webhookUrlForOrganization } from "../config.js";
import { getWhatsAppProvider } from "../providers/factory.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  exchangeEmbeddedSignupCode,
  exchangeForLongLivedToken,
  fetchFirstPhoneNumberId,
  getWhatsAppEmbeddedConfig,
  getWhatsAppEmbeddedPublicConfig,
  subscribeWabaToApp,
} from "../lib/metaWhatsAppEmbedded.js";

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

    const settings = await prisma.settings.findUnique({ where: { organizationId } });
    const p = settings?.whatsappProvider ?? null;
    return {
      whatsappProvider: p,
      /** Anexos / imagens na conversa — solicitado para Evolution API. */
      evolutionRichChat: p === "evolution",
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

      return maskSettings(settings, organizationId);
    });

    admin.put("/", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      let settings = await prisma.settings.findUnique({ where: { organizationId } });
      const data = { ...parsed.data };
      if (data.evolutionApiBaseUrl === "") data.evolutionApiBaseUrl = null;
      if (data.agentBotId === "") data.agentBotId = null;
      if (data.agentBotId) {
        const botOk = await prisma.bot.findFirst({
          where: { id: data.agentBotId, organizationId },
        });
        if (!botOk) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid agentBotId for this organization", statusCode: 400 });
        }
      }

      if (!settings) {
        settings = await prisma.settings.create({ data: { organizationId, ...data } });
      } else {
        settings = await prisma.settings.update({
          where: { id: settings.id },
          data,
        });
      }

      return maskSettings(settings, organizationId);
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
  });
}
