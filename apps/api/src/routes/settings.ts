import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { webhookUrlForOrganization } from "../config.js";
import { getWhatsAppProvider } from "../providers/factory.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const settingsSchema = z.object({
  whatsappProvider: z.enum(["meta", "360dialog", "twilio", "evolution"]).optional(),
  whatsappApiKey: z.string().max(500).optional(),
  whatsappPhoneNumberId: z.string().max(100).optional(),
  evolutionApiBaseUrl: z.union([z.string().url().max(512), z.literal(""), z.null()]).optional(),
  whatsappWebhookSecret: z.string().max(500).optional(),
  autoOptInOnFirstMessage: z.boolean().optional(),
  notifyConversationOpen: z.boolean().optional(),
  notifyConversationPending: z.boolean().optional(),
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
  });
}
