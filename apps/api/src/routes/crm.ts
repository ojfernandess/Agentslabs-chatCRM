import { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { getOrCreateDefaultPipeline } from "../lib/defaultPipeline.js";
import { appendTimelineEvent } from "../lib/timeline.js";
import { dealStatusFromLeadValueRollup } from "../lib/dealStageSync.js";
import { DealStatus, Prisma } from "@prisma/client";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";

async function requireCrmDeals(organizationId: string, reply: FastifyReply): Promise<boolean> {
  const enabled = await isOrganizationFeatureEnabled(organizationId, "crm_deals");
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "Negócios e produtos estão desativados para esta organização.",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

const timelineQuerySchema = z.object({
  subjectType: z.enum(["CONTACT", "ACCOUNT", "DEAL"]),
  subjectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const createAccountSchema = z.object({
  name: z.string().min(1).max(255),
  website: z.string().max(500).nullable().optional(),
  industry: z.string().max(120).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
});

const patchAccountSchema = createAccountSchema.partial();

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  sku: z.string().max(120).nullable().optional(),
  priceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
});

const patchProductSchema = createProductSchema.partial();

const createDealSchema = z.object({
  name: z.string().min(1).max(255),
  stageId: z.string().uuid(),
  pipelineId: z.string().uuid().optional(),
  accountId: z.string().uuid().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  probabilityPct: z.number().int().min(0).max(100).nullable().optional(),
  closeDate: z.coerce.date().nullable().optional(),
});

const patchDealSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  stageId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  status: z.nativeEnum(DealStatus).optional(),
  accountId: z.string().uuid().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  amountCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  probabilityPct: z.number().int().min(0).max(100).nullable().optional(),
  closeDate: z.coerce.date().nullable().optional(),
  lostReason: z.string().max(2000).nullable().optional(),
});

const createDealLineItemSchema = z.object({
  description: z.string().min(1).max(2000),
  quantity: z.number().int().min(1).optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  discountPct: z.number().int().min(0).max(100).optional(),
  productId: z.string().uuid().nullable().optional(),
});

const patchDealLineItemSchema = createDealLineItemSchema.partial();

function lineItemLineTotalCents(item: {
  quantity: number;
  unitPriceCents: number;
  discountPct: number;
}): number {
  const factor = Math.max(0, 1 - item.discountPct / 100);
  return Math.round(item.quantity * item.unitPriceCents * factor);
}

async function syncDealAmountFromLineItems(dealId: string): Promise<void> {
  const items = await prisma.dealLineItem.findMany({ where: { dealId } });
  const sum = items.reduce((acc, i) => acc + lineItemLineTotalCents(i), 0);
  await prisma.deal.update({ where: { id: dealId }, data: { amountCents: sum } });
}

async function findOrgStage(
  organizationId: string,
  stageId: string,
  pipelineId?: string,
): Promise<{ id: string; probabilityPct: number; pipelineId: string } | null> {
  return prisma.pipelineStage.findFirst({
    where: {
      id: stageId,
      pipeline: {
        organizationId,
        ...(pipelineId !== undefined ? { id: pipelineId } : {}),
      },
    },
    select: { id: true, probabilityPct: true, pipelineId: true },
  });
}

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** Estágios do pipeline principal (sem exigir feature `crm_kanban`, para ecrãs como Negócios). */
  app.get("/pipeline-stages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;
    await getOrCreateDefaultPipeline(prisma, organizationId);
    return prisma.pipelineStage.findMany({
      where: { pipeline: { organizationId, isDefault: true } },
      orderBy: { order: "asc" },
      include: { leadType: { select: { id: true, valueRollup: true } } },
    });
  });

  app.get("/timeline", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = timelineQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const { subjectType, subjectId, limit } = parsed.data;

    const subjectOk =
      (subjectType === "CONTACT" &&
        (await prisma.contact.count({ where: { id: subjectId, organizationId } })) > 0) ||
      (subjectType === "ACCOUNT" &&
        (await prisma.account.count({ where: { id: subjectId, organizationId } })) > 0) ||
      (subjectType === "DEAL" && (await prisma.deal.count({ where: { id: subjectId, organizationId } })) > 0);

    if (!subjectOk) {
      return reply.status(404).send({ error: "Not Found", message: "Subject not found", statusCode: 404 });
    }

    const events = await prisma.timelineEvent.findMany({
      where: { organizationId, subjectType, subjectId },
      orderBy: { occurredAt: "desc" },
      take: limit,
      include: { actorUser: { select: { id: true, name: true } } },
    });

    return { data: events };
  });

  app.get("/accounts", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const rows = await prisma.account.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 500,
      include: { owner: { select: { id: true, name: true } } },
    });
    return { data: rows };
  });

  app.post("/accounts", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = createAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const row = await prisma.account.create({
      data: {
        organizationId,
        name: parsed.data.name,
        website: parsed.data.website ?? undefined,
        industry: parsed.data.industry ?? undefined,
        ownerId: parsed.data.ownerId ?? undefined,
      },
    });
    return reply.status(201).send(row);
  });

  app.get<{ Params: { id: string } }>("/accounts/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const row = await prisma.account.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        owner: { select: { id: true, name: true } },
        contacts: { take: 50, orderBy: { updatedAt: "desc" } },
      },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Account not found", statusCode: 404 });
    }
    return row;
  });

  app.patch<{ Params: { id: string } }>("/accounts/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const parsed = patchAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const data: Prisma.AccountUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.website !== undefined) data.website = parsed.data.website;
    if (parsed.data.industry !== undefined) data.industry = parsed.data.industry;
    if (parsed.data.ownerId !== undefined) {
      data.owner =
        parsed.data.ownerId === null ? { disconnect: true } : { connect: { id: parsed.data.ownerId } };
    }
    const existingAcc = await prisma.account.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existingAcc) {
      return reply.status(404).send({ error: "Not Found", message: "Account not found", statusCode: 404 });
    }
    const row = await prisma.account.update({
      where: { id: existingAcc.id },
      data,
    });
    return row;
  });

  app.get("/products", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;
    const rows = await prisma.product.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: 500,
    });
    return { data: rows };
  });

  app.post("/products", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const row = await prisma.product.create({
      data: {
        organizationId,
        name: parsed.data.name,
        sku: parsed.data.sku ?? undefined,
        priceCents: parsed.data.priceCents ?? 0,
        currency: parsed.data.currency ?? "BRL",
        isActive: parsed.data.isActive ?? true,
      },
    });
    return reply.status(201).send(row);
  });

  app.patch<{ Params: { id: string } }>("/products/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;
    const parsed = patchProductSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const data: Prisma.ProductUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.sku !== undefined) data.sku = parsed.data.sku;
    if (parsed.data.priceCents !== undefined) data.priceCents = parsed.data.priceCents;
    if (parsed.data.currency !== undefined) data.currency = parsed.data.currency;
    if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
    const existingProd = await prisma.product.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existingProd) {
      return reply.status(404).send({ error: "Not Found", message: "Product not found", statusCode: 404 });
    }
    return await prisma.product.update({
      where: { id: existingProd.id },
      data,
    });
  });

  app.get("/deals", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;

    const where: Prisma.DealWhereInput = { organizationId };

    const rows = await prisma.deal.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: {
        stage: true,
        pipeline: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
        primaryContact: { select: { id: true, name: true, phone: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    return { data: rows };
  });

  app.post("/deals", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;

    const parsed = createDealSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const defaultPipeline = await getOrCreateDefaultPipeline(prisma, organizationId);
    const targetPipelineId = parsed.data.pipelineId ?? defaultPipeline.id;

    const stage = await findOrgStage(organizationId, parsed.data.stageId, targetPipelineId);
    if (!stage) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid pipeline stage", statusCode: 400 });
    }
    const pipelineId = stage.pipelineId;

    if (parsed.data.accountId) {
      const acc = await prisma.account.findFirst({
        where: { id: parsed.data.accountId, organizationId },
      });
      if (!acc) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid account", statusCode: 400 });
      }
    }

    if (parsed.data.primaryContactId) {
      const c = await prisma.contact.findFirst({
        where: { id: parsed.data.primaryContactId, organizationId },
      });
      if (!c) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid contact", statusCode: 400 });
      }
    }

    const prob = parsed.data.probabilityPct ?? stage.probabilityPct;

    const stageWithLt = await prisma.pipelineStage.findFirst({
      where: { id: stage.id },
      include: { leadType: { select: { valueRollup: true } } },
    });
    const initialStatus = dealStatusFromLeadValueRollup(stageWithLt?.leadType?.valueRollup);

    const deal = await prisma.deal.create({
      data: {
        organizationId,
        name: parsed.data.name,
        pipelineId,
        stageId: stage.id,
        status: initialStatus,
        amountCents: parsed.data.amountCents ?? 0,
        currency: parsed.data.currency ?? "BRL",
        probabilityPct: prob,
        closeDate: parsed.data.closeDate ?? undefined,
        accountId: parsed.data.accountId ?? undefined,
        primaryContactId: parsed.data.primaryContactId ?? undefined,
        ownerId: parsed.data.ownerId ?? request.user.id,
      },
      include: {
        stage: true,
        pipeline: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
        primaryContact: { select: { id: true, name: true } },
      },
    });

    await appendTimelineEvent({
      organizationId,
      subjectType: "DEAL",
      subjectId: deal.id,
      eventType: "deal.created",
      payload: { dealId: deal.id, name: deal.name },
      actorUserId: request.user.id,
    });

    if (deal.primaryContactId) {
      await appendTimelineEvent({
        organizationId,
        subjectType: "CONTACT",
        subjectId: deal.primaryContactId,
        eventType: "deal.linked",
        payload: { dealId: deal.id, name: deal.name },
        actorUserId: request.user.id,
      });
    }

    return reply.status(201).send(deal);
  });

  app.get<{ Params: { id: string } }>("/deals/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;
    const row = await prisma.deal.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        stage: true,
        pipeline: true,
        account: true,
        primaryContact: true,
        owner: { select: { id: true, name: true } },
        lineItems: { include: { product: true } },
      },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Deal not found", statusCode: 404 });
    }
    return row;
  });

  app.patch<{ Params: { id: string } }>("/deals/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;

    const parsed = patchDealSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.deal.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Deal not found", statusCode: 404 });
    }

    if (parsed.data.pipelineId !== undefined && parsed.data.stageId === undefined) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "stageId is required when changing pipeline",
        statusCode: 400,
      });
    }

    let nextPipelineId = existing.pipelineId;
    let nextStageId = existing.stageId;

    if (parsed.data.stageId !== undefined) {
      const stage = await findOrgStage(organizationId, parsed.data.stageId, parsed.data.pipelineId);
      if (!stage) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid pipeline stage", statusCode: 400 });
      }
      if (parsed.data.pipelineId !== undefined && stage.pipelineId !== parsed.data.pipelineId) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Stage does not belong to the given pipeline",
          statusCode: 400,
        });
      }
      nextPipelineId = stage.pipelineId;
      nextStageId = stage.id;
    }

    const data: Prisma.DealUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.status !== undefined) data.status = parsed.data.status;
    if (parsed.data.amountCents !== undefined) data.amountCents = parsed.data.amountCents;
    if (parsed.data.currency !== undefined) data.currency = parsed.data.currency;
    if (parsed.data.probabilityPct !== undefined) data.probabilityPct = parsed.data.probabilityPct;
    if (parsed.data.closeDate !== undefined) data.closeDate = parsed.data.closeDate;
    if (parsed.data.lostReason !== undefined) data.lostReason = parsed.data.lostReason;
    if (parsed.data.ownerId !== undefined) {
      data.owner =
        parsed.data.ownerId === null ? { disconnect: true } : { connect: { id: parsed.data.ownerId } };
    }

    if (parsed.data.accountId !== undefined) {
      if (parsed.data.accountId === null) {
        data.account = { disconnect: true };
      } else {
        const acc = await prisma.account.findFirst({
          where: { id: parsed.data.accountId, organizationId },
        });
        if (!acc) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid account", statusCode: 400 });
        }
        data.account = { connect: { id: parsed.data.accountId } };
      }
    }

    if (parsed.data.primaryContactId !== undefined) {
      if (parsed.data.primaryContactId === null) {
        data.primaryContact = { disconnect: true };
      } else {
        const c = await prisma.contact.findFirst({
          where: { id: parsed.data.primaryContactId, organizationId },
        });
        if (!c) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid contact", statusCode: 400 });
        }
        data.primaryContact = { connect: { id: parsed.data.primaryContactId } };
      }
    }

    if (parsed.data.stageId !== undefined) {
      data.pipeline = { connect: { id: nextPipelineId } };
      data.stage = { connect: { id: nextStageId } };
      const stRow = await prisma.pipelineStage.findFirst({
        where: { id: nextStageId, pipeline: { organizationId } },
        include: { leadType: { select: { valueRollup: true } } },
      });
      data.status = dealStatusFromLeadValueRollup(stRow?.leadType?.valueRollup);
      if (stRow) data.probabilityPct = stRow.probabilityPct;
    }

    const updated = await prisma.deal.update({
      where: { id: existing.id },
      data,
      include: {
        stage: true,
        pipeline: { select: { id: true, name: true } },
        account: { select: { id: true, name: true } },
        primaryContact: { select: { id: true, name: true } },
      },
    });

    await appendTimelineEvent({
      organizationId,
      subjectType: "DEAL",
      subjectId: updated.id,
      eventType: "deal.updated",
      payload: { fields: Object.keys(parsed.data) },
      actorUserId: request.user.id,
    });

    return updated;
  });

  app.delete<{ Params: { id: string } }>("/deals/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;
    const existing = await prisma.deal.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Deal not found", statusCode: 404 });
    }
    await prisma.deal.delete({ where: { id: existing.id } });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/deals/:id/line-items", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireCrmDeals(organizationId, reply))) return;

    const deal = await prisma.deal.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!deal) {
      return reply.status(404).send({ error: "Not Found", message: "Deal not found", statusCode: 404 });
    }

    const parsed = createDealLineItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    if (parsed.data.productId) {
      const p = await prisma.product.findFirst({
        where: { id: parsed.data.productId, organizationId },
      });
      if (!p) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid product", statusCode: 400 });
      }
    }

    const item = await prisma.dealLineItem.create({
      data: {
        dealId: deal.id,
        description: parsed.data.description,
        quantity: parsed.data.quantity ?? 1,
        unitPriceCents: parsed.data.unitPriceCents ?? 0,
        discountPct: parsed.data.discountPct ?? 0,
        productId: parsed.data.productId ?? undefined,
      },
      include: { product: true },
    });

    await syncDealAmountFromLineItems(deal.id);
    return reply.status(201).send(item);
  });

  app.patch<{ Params: { id: string; lineId: string } }>(
    "/deals/:id/line-items/:lineId",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!(await requireCrmDeals(organizationId, reply))) return;

      const existing = await prisma.dealLineItem.findFirst({
        where: {
          id: request.params.lineId,
          dealId: request.params.id,
          deal: { organizationId },
        },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Not Found", message: "Line item not found", statusCode: 404 });
      }

      const parsed = patchDealLineItemSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      if (parsed.data.productId) {
        const p = await prisma.product.findFirst({
          where: { id: parsed.data.productId, organizationId },
        });
        if (!p) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid product", statusCode: 400 });
        }
      }

      const data: Prisma.DealLineItemUpdateInput = {};
      if (parsed.data.description !== undefined) data.description = parsed.data.description;
      if (parsed.data.quantity !== undefined) data.quantity = parsed.data.quantity;
      if (parsed.data.unitPriceCents !== undefined) data.unitPriceCents = parsed.data.unitPriceCents;
      if (parsed.data.discountPct !== undefined) data.discountPct = parsed.data.discountPct;
      if (parsed.data.productId !== undefined) {
        data.product =
          parsed.data.productId === null ? { disconnect: true } : { connect: { id: parsed.data.productId } };
      }

      const item = await prisma.dealLineItem.update({
        where: { id: existing.id },
        data,
        include: { product: true },
      });
      await syncDealAmountFromLineItems(request.params.id);
      return item;
    },
  );

  app.delete<{ Params: { id: string; lineId: string } }>(
    "/deals/:id/line-items/:lineId",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      if (!(await requireCrmDeals(organizationId, reply))) return;

      const res = await prisma.dealLineItem.deleteMany({
        where: {
          id: request.params.lineId,
          dealId: request.params.id,
          deal: { organizationId },
        },
      });
      if (res.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Line item not found", statusCode: 404 });
      }
      await syncDealAmountFromLineItems(request.params.id);
      return reply.status(204).send();
    },
  );
}
