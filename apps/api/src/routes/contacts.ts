import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { normalizePhoneE164, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const createContactSchema = z.object({
  phone: z.string().min(7).max(16),
  name: z.string().min(1).max(255),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().uuid()).optional(),
});

const updateContactSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().min(7).max(16).optional(),
  notes: z.string().max(5000).optional(),
  pipelineStageId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  optedIn: z.boolean().optional(),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().optional(),
  tag: z.string().uuid().optional(),
  stage: z.string().uuid().optional(),
  assignee: z.string().uuid().optional(),
});

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = querySchema.parse(request.query);
    const where: Record<string, unknown> = { organizationId };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search } },
      ];
    }
    if (query.tag) {
      where.tags = { some: { tagId: query.tag } };
    }
    if (query.stage) {
      where.pipelineStageId = query.stage;
    }
    if (query.assignee) {
      where.assignedToId = query.assignee;
    }

    if (request.user.role === "AGENT") {
      where.assignedToId = request.user.id;
    }

    const [data, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          pipelineStage: true,
          assignedTo: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.contact.count({ where }),
    ]);

    return { data, total, page: query.page, pageSize: query.pageSize };
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const contact = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        tags: { include: { tag: true } },
        pipelineStage: true,
        assignedTo: { select: { id: true, name: true } },
        conversations: { orderBy: { updatedAt: "desc" }, take: 1 },
      },
    });

    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT" && contact.assignedToId !== request.user.id) {
      return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
    }

    return contact;
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createContactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const phone = normalizePhoneE164(parsed.data.phone);
    if (!phone) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid phone number format", statusCode: 400 });
    }

    const existing = await prisma.contact.findFirst({ where: { organizationId, phone } });
    if (existing) {
      return reply
        .status(409)
        .send({ error: "Conflict", message: "Contact with this phone number already exists", statusCode: 409 });
    }

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: parsed.data.name,
        notes: parsed.data.notes,
        tags: parsed.data.tags
          ? { create: parsed.data.tags.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: { tags: { include: { tag: true } } },
    });

    return reply.status(201).send(contact);
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateContactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const current = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!current) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.pipelineStageId !== undefined) data.pipelineStageId = parsed.data.pipelineStageId;
    if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;
    if (parsed.data.optedIn !== undefined) {
      data.optedIn = parsed.data.optedIn;
      if (parsed.data.optedIn) data.optedInAt = new Date();
    }

    if (parsed.data.phone !== undefined) {
      const normalized = normalizePhoneE164(parsed.data.phone);
      if (!normalized) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid phone number format", statusCode: 400 });
      }
      if (normalized !== current.phone) {
        const conflict = await prisma.contact.findFirst({
          where: { organizationId, phone: normalized, NOT: { id: current.id } },
        });
        if (conflict) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Contact with this phone number already exists",
            statusCode: 409,
          });
        }
      }
      data.phone = normalized;
    }

    try {
      const contact = await prisma.contact.update({
        where: { id: request.params.id },
        data,
        include: { tags: { include: { tag: true } }, pipelineStage: true },
      });
      return contact;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.contact.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/:id/messages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const contact = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        conversations: {
          include: {
            messages: { orderBy: { createdAt: "asc" } },
          },
        },
      },
    });

    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const messages = contact.conversations.flatMap((c) => c.messages);
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return messages;
  });

  app.post<{ Params: { id: string } }>("/:id/tags", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({ tagIds: z.array(z.string().uuid()) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const contactExists = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!contactExists) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    await prisma.contactTag.createMany({
      data: parsed.data.tagIds.map((tagId) => ({
        contactId: request.params.id,
        tagId,
      })),
      skipDuplicates: true,
    });

    const unknownTag = await prisma.tag.findFirst({
      where: { organizationId, name: "Desconhecido" },
    });
    if (unknownTag && !parsed.data.tagIds.includes(unknownTag.id)) {
      await prisma.contactTag.deleteMany({
        where: { contactId: request.params.id, tagId: unknownTag.id },
      });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
      include: { tags: { include: { tag: true } } },
    });

    return contact;
  });

  app.delete<{ Params: { id: string; tagId: string } }>("/:id/tags/:tagId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const contactExists = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!contactExists) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    try {
      await prisma.contactTag.delete({
        where: {
          contactId_tagId: {
            contactId: request.params.id,
            tagId: request.params.tagId,
          },
        },
      });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Tag assignment not found", statusCode: 404 });
    }
  });

  app.put<{ Params: { id: string } }>("/:id/stage", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({ stageId: z.string().uuid().nullable() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const current = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!current) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    if (parsed.data.stageId) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: parsed.data.stageId, organizationId },
      });
      if (!stage) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid pipeline stage", statusCode: 400 });
      }
    }

    try {
      const contact = await prisma.contact.update({
        where: { id: request.params.id },
        data: { pipelineStageId: parsed.data.stageId },
        include: { pipelineStage: true },
      });
      return contact;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
  });
}
