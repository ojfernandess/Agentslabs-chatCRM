import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import type { Prisma } from "@prisma/client";

const createInboxSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional().nullable(),
  isDefault: z.boolean().optional(),
});

const patchInboxSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (request.user.role === "AGENT") {
      const rows = await prisma.inbox.findMany({
        where: {
          organizationId,
          members: { some: { userId: request.user.id } },
        },
        select: {
          id: true,
          name: true,
          description: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { members: true, conversations: true } },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return { data: rows };
    }

    const rows = await prisma.inbox.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { members: true, conversations: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return { data: rows };
  });

  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createInboxSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const body = parsed.data;
    let inbox;

    if (body.isDefault) {
      inbox = await prisma.$transaction(async (tx) => {
        await tx.inbox.updateMany({ where: { organizationId }, data: { isDefault: false } });
        return tx.inbox.create({
          data: {
            organizationId,
            name: body.name.trim(),
            description: body.description ?? undefined,
            isDefault: true,
          },
        });
      });
    } else {
      inbox = await prisma.inbox.create({
        data: {
          organizationId,
          name: body.name.trim(),
          description: body.description ?? undefined,
          isDefault: false,
        },
      });
    }

    return reply.status(201).send(inbox);
  });

  app.get<{ Params: { id: string } }>("/:id/members", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const m = await prisma.inboxMember.findFirst({
        where: { inboxId: inbox.id, userId: request.user.id },
      });
      if (!m) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
    }

    const rows = await prisma.inboxMember.findMany({
      where: { inboxId: inbox.id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { data: rows };
  });

  app.post<{ Params: { id: string } }>("/:id/members", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
      select: { id: true },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const parsed = addMemberSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organizationId },
      select: { id: true },
    });
    if (!user) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid userId", statusCode: 400 });
    }

    const r = await prisma.inboxMember.createMany({
      data: [{ inboxId: inbox.id, userId: user.id }],
      skipDuplicates: true,
    });
    return reply.status(r.count > 0 ? 201 : 200).send({ ok: true });
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    "/:id/members/:userId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const inbox = await prisma.inbox.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true, isDefault: true },
      });
      if (!inbox) {
        return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
      }

      const deleted = await prisma.inboxMember.deleteMany({
        where: { inboxId: inbox.id, userId: request.params.userId },
      });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "Not Found", message: "Member not found", statusCode: 404 });
      }

      return { ok: true };
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        _count: { select: { members: true, conversations: true } },
      },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    if (request.user.role === "AGENT") {
      const m = inbox.members.find((x) => x.userId === request.user.id);
      if (!m) {
        return reply.status(403).send({ error: "Forbidden", message: "Access denied", statusCode: 403 });
      }
      // Agente: omitir lista de membros (detalhe obtido em GET …/members se for membro).
      const { members: _m, ...rest } = inbox;
      return rest;
    }

    return inbox;
  });

  app.patch<{ Params: { id: string } }>("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = patchInboxSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const inbox = await prisma.inbox.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!inbox) {
      return reply.status(404).send({ error: "Not Found", message: "Inbox not found", statusCode: 404 });
    }

    const p = parsed.data;
    if (Object.keys(p).length === 0) {
      return reply.status(400).send({ error: "Bad Request", message: "No fields to update", statusCode: 400 });
    }

    const data: Prisma.InboxUpdateInput = {};
    if (p.name !== undefined) data.name = p.name.trim();
    if (p.description !== undefined) data.description = p.description;
    if (p.isDefault === true) {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.inbox.updateMany({ where: { organizationId }, data: { isDefault: false } });
        return tx.inbox.update({ where: { id: inbox.id }, data: { ...data, isDefault: true } });
      });
      return updated;
    }
    if (p.isDefault === false && inbox.isDefault) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Cannot unset default; set another inbox as default first",
        statusCode: 400,
      });
    }

    return prisma.inbox.update({ where: { id: inbox.id }, data });
  });
}
