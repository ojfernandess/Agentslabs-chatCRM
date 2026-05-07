import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";

const reminderSchema = z.object({
  contactId: z.string().uuid(),
  note: z.string().min(1).max(2000),
  dueAt: z.string().datetime(),
});

const updateReminderSchema = z.object({
  note: z.string().min(1).max(2000).optional(),
  dueAt: z.string().datetime().optional(),
  completed: z.boolean().optional(),
});

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = request.query as Record<string, string>;
    const filter = query.filter;
    const search = query.search?.trim();
    const where: Record<string, unknown> = {
      userId: request.user.id,
      organizationId,
    };

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    if (filter === "today") {
      where.dueAt = { gte: startOfToday, lte: endOfDay };
      where.completed = false;
    } else if (filter === "overdue") {
      where.dueAt = { lt: now };
      where.completed = false;
    } else if (filter === "upcoming") {
      where.dueAt = { gt: endOfDay };
      where.completed = false;
    }

    if (search) {
      where.OR = [
        { note: { contains: search, mode: "insensitive" } },
        { contact: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    return prisma.reminder.findMany({
      where,
      include: { contact: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueAt: "asc" },
    });
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = reminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId },
    });
    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const reminder = await prisma.reminder.create({
      data: {
        organizationId,
        contactId: parsed.data.contactId,
        userId: request.user.id,
        note: parsed.data.note,
        dueAt: new Date(parsed.data.dueAt),
      },
      include: { contact: { select: { id: true, name: true, phone: true } } },
    });

    return reply.status(201).send(reminder);
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.reminder.findFirst({
      where: { id: request.params.id, userId: request.user.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Reminder not found", statusCode: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.note !== undefined) data.note = parsed.data.note;
    if (parsed.data.dueAt !== undefined) data.dueAt = new Date(parsed.data.dueAt);
    if (parsed.data.completed !== undefined) data.completed = parsed.data.completed;

    const reminder = await prisma.reminder.update({
      where: { id: existing.id },
      data,
      include: { contact: { select: { id: true, name: true, phone: true } } },
    });
    return reminder;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.reminder.deleteMany({
      where: { id: request.params.id, userId: request.user.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Reminder not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
