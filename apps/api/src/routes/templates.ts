import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { maxBodyPlaceholderIndex } from "../lib/templateVariables.js";
import { syncWabaTemplatesForOrganization } from "../lib/syncWabaTemplates.js";
import { resolveEvolutionApiCredentials } from "../lib/evolutionPlatform.js";
import { evolutionCreateBusinessTemplate } from "../providers/evolution.js";

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  body: z.string().min(1).max(4096),
  providerTemplateId: z.string().max(255).optional(),
  isApproved: z.boolean().optional(),
  templateLanguage: z.string().min(2).max(32).optional(),
});

const evolutionTemplateSchema = z.object({
  name: z.string().min(1).max(512),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  language: z.string().min(2).max(32),
  body: z.string().min(1).max(4096),
  footer: z.string().max(160).optional(),
});

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const q = request.query as { inboxId?: string };
    await syncWabaTemplatesForOrganization(organizationId, { inboxId: q?.inboxId, log: app.log });
    return prisma.messageTemplate.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  });

  app.post("/meta/sync", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const q = request.query as { inboxId?: string };
    const result = await syncWabaTemplatesForOrganization(organizationId, { inboxId: q?.inboxId, log: app.log });
    if (!result.source) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Configure Meta Cloud API or 360dialog on a WhatsApp inbox first",
        statusCode: 400,
      });
    }
    return result;
  });

  app.post("/evolution", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const settings = await prisma.settings.findUnique({ where: { organizationId } });
    if (settings?.whatsappProvider !== "evolution") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Evolution API must be selected as the WhatsApp provider",
        statusCode: 400,
      });
    }
    const creds = await resolveEvolutionApiCredentials(settings);
    if (!creds) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Configure Evolution (instance / URL & API key, or QR-managed mode) first",
        statusCode: 400,
      });
    }

    const parsed = evolutionTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      await evolutionCreateBusinessTemplate({
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        instanceName: creds.instanceName,
        name: parsed.data.name,
        category: parsed.data.category,
        language: parsed.data.language,
        body: parsed.data.body,
        footer: parsed.data.footer,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Evolution template/create failed";
      return reply.status(502).send({ error: "Bad Gateway", message: msg, statusCode: 502 });
    }

    const bodyVariableCount = maxBodyPlaceholderIndex(parsed.data.body);
    const row = await prisma.messageTemplate.create({
      data: {
        organizationId,
        name: parsed.data.name,
        body: parsed.data.body,
        providerTemplateId: null,
        templateLanguage: parsed.data.language,
        bodyVariableCount,
        metaCategory: parsed.data.category,
        isApproved: false,
      },
    });
    return reply.status(201).send(row);
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const bodyVariableCount = maxBodyPlaceholderIndex(parsed.data.body);
    const { templateLanguage: tl, ...rest } = parsed.data;
    const template = await prisma.messageTemplate.create({
      data: {
        ...rest,
        templateLanguage: tl ?? "en",
        bodyVariableCount,
        organizationId,
      },
    });
    return reply.status(201).send(template);
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = templateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const bodyVariableCount = maxBodyPlaceholderIndex(parsed.data.body);
    const tl = parsed.data.templateLanguage;

    const res = await prisma.messageTemplate.updateMany({
      where: { id: request.params.id, organizationId },
      data: {
        name: parsed.data.name,
        body: parsed.data.body,
        providerTemplateId: parsed.data.providerTemplateId,
        isApproved: parsed.data.isApproved,
        bodyVariableCount,
        ...(tl != null ? { templateLanguage: tl } : {}),
      },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
    }
    return prisma.messageTemplate.findFirst({
      where: { id: request.params.id, organizationId },
    });
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.messageTemplate.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Template not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
