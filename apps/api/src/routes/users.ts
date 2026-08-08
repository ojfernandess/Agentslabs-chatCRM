import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { config } from "../config.js";
import { isValidEmail } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { addAgentToAllOrganizationTeams } from "../lib/agentScope.js";
import { addUserToDefaultInboxes } from "../lib/defaultInbox.js";
import { availabilityToClient } from "../lib/userAvailability.js";

const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(["ADMIN", "AGENT"]),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128).optional(),
  role: z.enum(["ADMIN", "AGENT"]).optional(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** Lista mínima de colegas da org para transferência/reatribuição (qualquer utilizador autenticado). */
  app.get("/assignable", { preHandler: authenticate }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, availabilityStatus: true },
      orderBy: { name: "asc" },
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        availabilityStatus: availabilityToClient(row.availabilityStatus),
      })),
    );
  });

  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", requireAdmin);

    adminApp.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  });

    adminApp.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    if (!isValidEmail(parsed.data.email)) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid email format", statusCode: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      return reply.status(409).send({ error: "Conflict", message: "User with this email already exists", statusCode: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, config.bcryptCostFactor);

    const user = await prisma.user.create({
      data: {
        organizationId,
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role,
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    if (user.role === "AGENT") {
      await addAgentToAllOrganizationTeams(organizationId, user.id);
    }

    await addUserToDefaultInboxes(organizationId, user.id);

    return reply.status(201).send(user);
  });

    adminApp.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const target = await prisma.user.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!target) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    if (parsed.data.role !== undefined) data.role = parsed.data.role;
    if (parsed.data.password !== undefined) {
      data.passwordHash = await bcrypt.hash(parsed.data.password, config.bcryptCostFactor);
    }

    const user = await prisma.user.update({
      where: { id: target.id },
      data,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    if (user.role === "AGENT") {
      await addAgentToAllOrganizationTeams(organizationId, user.id);
    }

    return user;
  });

    adminApp.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    if (request.params.id === request.user.id) {
      return reply.status(400).send({ error: "Bad Request", message: "Cannot delete your own account", statusCode: 400 });
    }

    const res = await prisma.user.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }
    return reply.status(204).send();
    });
  });
}
