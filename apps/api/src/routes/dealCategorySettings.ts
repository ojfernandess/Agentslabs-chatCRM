import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { prisma } from "../db.js";
import {
  buildDealCategoryContext,
  ensureCategoryOptionSets,
  getOrCreateDealOrgSettings,
  getDealCategoryCatalogResponse,
  loadDealFieldConfig,
} from "../lib/dealCategories/dealCategoryService.js";
import { normalizeDealCategory } from "@openconduit/shared";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";

async function requireCrmDealsFlag(organizationId: string): Promise<boolean> {
  return isOrganizationFeatureEnabled(organizationId, "crm_deals");
}

const patchSettingsSchema = z.object({
  activeCategory: z.string().min(1).max(64).optional(),
  autoGenerateLineItems: z.boolean().optional(),
});

const fieldOverrideSchema = z.object({
  categoryKey: z.string().min(1).max(64),
  fieldKey: z.string().min(1).max(120),
  enabled: z.boolean(),
  required: z.boolean(),
  sortOrder: z.number().int().min(0).optional(),
});

const customFieldSchema = z.object({
  fieldKey: z.string().min(1).max(120).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(255),
  type: z.enum(["text", "number", "money", "date", "datetime", "select", "multiselect", "boolean", "percentage"]),
  required: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  options: z.array(z.string()).optional(),
});

const optionSchema = z.object({
  name: z.string().min(1).max(255),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const productCategorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  dealCategoryKey: z.string().max(64).nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Rotas de configuração de categorias de negócio (extensão crm_deals). */
export async function dealCategorySettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/deal-categories", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDealsFlag(organizationId))) {
      return reply.status(403).send({ error: "Forbidden", message: "crm_deals disabled", statusCode: 403 });
    }
    return { data: getDealCategoryCatalogResponse() };
  });

  app.get("/deal-category-context", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDealsFlag(organizationId))) {
      return reply.status(403).send({ error: "Forbidden", message: "crm_deals disabled", statusCode: 403 });
    }
    return { data: await buildDealCategoryContext(organizationId) };
  });

  app.get("/deal-settings", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDealsFlag(organizationId))) {
      return reply.status(403).send({ error: "Forbidden", message: "crm_deals disabled", statusCode: 403 });
    }
    const settings = await getOrCreateDealOrgSettings(organizationId);
    return {
      data: {
        activeCategory: normalizeDealCategory(settings.activeCategory),
        autoGenerateLineItems: settings.autoGenerateLineItems,
      },
    };
  });

  app.patch("/deal-settings", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDealsFlag(organizationId))) {
      return reply.status(403).send({ error: "Forbidden", message: "crm_deals disabled", statusCode: 403 });
    }
    const body = patchSettingsSchema.parse(request.body ?? {});
    const cat = body.activeCategory ? normalizeDealCategory(body.activeCategory) : undefined;
    if (cat) await ensureCategoryOptionSets(organizationId, cat);

    const settings = await prisma.dealOrgSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        activeCategory: cat ?? "default",
        autoGenerateLineItems: body.autoGenerateLineItems ?? false,
      },
      update: {
        ...(cat !== undefined ? { activeCategory: cat } : {}),
        ...(body.autoGenerateLineItems !== undefined
          ? { autoGenerateLineItems: body.autoGenerateLineItems }
          : {}),
      },
    });

    return {
      data: {
        activeCategory: normalizeDealCategory(settings.activeCategory),
        autoGenerateLineItems: settings.autoGenerateLineItems,
      },
    };
  });

  app.get("/deal-field-config", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const q = z.object({ categoryKey: z.string().optional() }).parse(request.query ?? {});
    const settings = await getOrCreateDealOrgSettings(organizationId);
    const categoryKey = normalizeDealCategory(q.categoryKey ?? settings.activeCategory);
    const fields = await loadDealFieldConfig(organizationId, categoryKey);
    const overrides = await prisma.dealFieldOverride.findMany({
      where: { organizationId, categoryKey },
    });
    return { data: { categoryKey, fields, overrides } };
  });

  app.put("/deal-field-overrides", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const body = z.object({ overrides: z.array(fieldOverrideSchema) }).parse(request.body ?? {});

    for (const o of body.overrides) {
      await prisma.dealFieldOverride.upsert({
        where: {
          organizationId_categoryKey_fieldKey: {
            organizationId,
            categoryKey: o.categoryKey,
            fieldKey: o.fieldKey,
          },
        },
        create: {
          organizationId,
          categoryKey: o.categoryKey,
          fieldKey: o.fieldKey,
          enabled: o.enabled,
          required: o.required,
          sortOrder: o.sortOrder ?? 0,
        },
        update: {
          enabled: o.enabled,
          required: o.required,
          ...(o.sortOrder !== undefined ? { sortOrder: o.sortOrder } : {}),
        },
      });
    }
    return reply.status(204).send();
  });

  app.get("/deal-custom-fields", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const rows = await prisma.dealCustomField.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }],
    });
    return { data: rows };
  });

  app.post("/deal-custom-fields", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const body = customFieldSchema.parse(request.body ?? {});
    const row = await prisma.dealCustomField.create({
      data: {
        organizationId,
        categoryKey: "custom",
        fieldKey: body.fieldKey,
        label: body.label,
        type: body.type,
        required: body.required ?? false,
        enabled: body.enabled ?? true,
        sortOrder: body.sortOrder ?? 0,
        options: body.options ?? undefined,
      },
    });
    return reply.status(201).send({ data: row });
  });

  app.delete<{ Params: { id: string } }>(
    "/deal-custom-fields/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const row = await prisma.dealCustomField.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!row) return reply.status(404).send({ error: "Not Found", statusCode: 404 });
      await prisma.dealCustomField.delete({ where: { id: row.id } });
      return reply.status(204).send();
    },
  );

  app.get("/deal-option-sets", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const sets = await prisma.dealOptionSet.findMany({
      where: { organizationId },
      include: { options: { orderBy: { sortOrder: "asc" } } },
      orderBy: { setKey: "asc" },
    });
    return { data: sets };
  });

  app.post<{ Params: { setKey: string } }>(
    "/deal-option-sets/:setKey/options",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const body = optionSchema.parse(request.body ?? {});
      const setKey = decodeURIComponent(request.params.setKey);
      const set = await prisma.dealOptionSet.upsert({
        where: { organizationId_setKey: { organizationId, setKey } },
        create: { organizationId, setKey, label: setKey },
        update: {},
      });
      const maxOrder = await prisma.dealOptionSetOption.aggregate({
        where: { optionSetId: set.id },
        _max: { sortOrder: true },
      });
      const option = await prisma.dealOptionSetOption.create({
        data: {
          optionSetId: set.id,
          name: body.name,
          enabled: body.enabled ?? true,
          sortOrder: body.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1,
        },
      });
      return reply.status(201).send({ data: option });
    },
  );

  app.patch<{ Params: { optionId: string } }>(
    "/deal-option-set-options/:optionId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const body = optionSchema.partial().parse(request.body ?? {});
      const existing = await prisma.dealOptionSetOption.findFirst({
        where: {
          id: request.params.optionId,
          optionSet: { organizationId },
        },
      });
      if (!existing) return reply.status(404).send({ error: "Not Found", statusCode: 404 });
      const updated = await prisma.dealOptionSetOption.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      });
      return { data: updated };
    },
  );

  app.delete<{ Params: { optionId: string } }>(
    "/deal-option-set-options/:optionId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const existing = await prisma.dealOptionSetOption.findFirst({
        where: {
          id: request.params.optionId,
          optionSet: { organizationId },
        },
      });
      if (!existing) return reply.status(404).send({ error: "Not Found", statusCode: 404 });
      await prisma.dealOptionSetOption.delete({ where: { id: existing.id } });
      return reply.status(204).send();
    },
  );

  app.get("/product-categories", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const rows = await prisma.productCategory.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { data: rows };
  });

  app.post("/product-categories", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const body = productCategorySchema.parse(request.body ?? {});
    const row = await prisma.productCategory.create({
      data: {
        organizationId,
        name: body.name,
        description: body.description ?? undefined,
        dealCategoryKey: body.dealCategoryKey ?? undefined,
        enabled: body.enabled ?? true,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    return reply.status(201).send({ data: row });
  });

  app.patch<{ Params: { id: string } }>(
    "/product-categories/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const body = productCategorySchema.partial().parse(request.body ?? {});
      const existing = await prisma.productCategory.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!existing) return reply.status(404).send({ error: "Not Found", statusCode: 404 });
      const updated = await prisma.productCategory.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.dealCategoryKey !== undefined ? { dealCategoryKey: body.dealCategoryKey } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        },
      });
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/product-categories/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const existing = await prisma.productCategory.findFirst({
        where: { id: request.params.id, organizationId },
      });
      if (!existing) return reply.status(404).send({ error: "Not Found", statusCode: 404 });
      await prisma.product.updateMany({
        where: { productCategoryId: existing.id },
        data: { productCategoryId: null },
      });
      await prisma.productCategory.delete({ where: { id: existing.id } });
      return reply.status(204).send();
    },
  );
}
