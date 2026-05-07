import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { maxBodyPlaceholderIndex } from "../lib/templateVariables.js";
import {
  fetchWabaIdFromPhoneNumberId,
  listApprovedWabaMessageTemplates,
  metaTemplateToLocalFields,
} from "../lib/metaWabaTemplates.js";
import { evolutionCreateBusinessTemplate } from "../providers/evolution.js";

async function syncWabaTemplatesForOrganization(organizationId: string, log: FastifyInstance["log"]): Promise<void> {
  const settings = await prisma.settings.findUnique({ where: { organizationId } });
  if (!settings?.whatsappApiKey?.trim() || !settings.whatsappPhoneNumberId?.trim()) return;
  const p = settings.whatsappProvider;
  if (p !== "meta" && p !== "360dialog") return;

  try {
    const wabaId = await fetchWabaIdFromPhoneNumberId(
      settings.whatsappPhoneNumberId,
      settings.whatsappApiKey,
    );
    if (!wabaId) {
      log.warn({ organizationId }, "WABA template sync: phone number has no whatsapp_business_account");
      return;
    }
    const list = await listApprovedWabaMessageTemplates(wabaId, settings.whatsappApiKey);
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
    }
  } catch (err) {
    log.warn({ err, organizationId }, "WABA template sync failed");
  }
}

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
    await syncWabaTemplatesForOrganization(organizationId, app.log);
    return prisma.messageTemplate.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
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
    const baseUrl = settings.evolutionApiBaseUrl?.trim() ?? "";
    const instance = settings.whatsappPhoneNumberId?.trim() ?? "";
    const apiKey = settings.whatsappApiKey?.trim() ?? "";
    if (!baseUrl || !instance || !apiKey) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Configure Evolution base URL, instance name and API key first",
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
        baseUrl,
        apiKey,
        instanceName: instance,
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
