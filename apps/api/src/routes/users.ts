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
import { listAssignableUsers } from "../lib/assignableUsers.js";
import {
  ensureMembership,
  getMembership,
  isOrgMemberRole,
  organizationMembersWhere,
} from "../lib/organizationMemberships.js";

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
    return listAssignableUsers(organizationId);
  });

  await app.register(async (adminApp) => {
    adminApp.addHook("preHandler", requireAdmin);

    adminApp.get("/", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const members = await prisma.organizationMembership.findMany({
        where: { organizationId },
        include: {
          user: {
            select: { id: true, name: true, email: true, createdAt: true },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      if (members.length > 0) {
        return members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          createdAt: m.user.createdAt,
        }));
      }

      // Fallback legado (pré-migration / sem backfill).
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

      const email = parsed.data.email.trim().toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.role === "SUPER_ADMIN") {
          return reply.status(409).send({
            error: "Conflict",
            message: "User with this email already exists",
            statusCode: 409,
          });
        }
        const membership = await getMembership(organizationId, existing.id);
        if (membership) {
          return reply.status(409).send({
            error: "Conflict",
            message: "User is already a member of this organization",
            statusCode: 409,
          });
        }
        return reply.status(409).send({
          error: "Conflict",
          message: "User with this email already exists. Invite them to join this organization instead.",
          statusCode: 409,
          code: "USE_INVITE_FOR_EXISTING_USER",
        });
      }

      const passwordHash = await bcrypt.hash(parsed.data.password, config.bcryptCostFactor);

      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            organizationId,
            name: parsed.data.name,
            email,
            passwordHash,
            role: parsed.data.role,
          },
          select: { id: true, name: true, email: true, role: true, createdAt: true },
        });
        await ensureMembership(
          {
            organizationId,
            userId: created.id,
            role: parsed.data.role,
          },
          tx,
        );
        return created;
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
        where: { id: request.params.id, ...organizationMembersWhere(organizationId) },
      });
      if (!target) {
        return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
      }

      const data: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) data.name = parsed.data.name;
      if (parsed.data.email !== undefined) data.email = parsed.data.email;
      if (parsed.data.password !== undefined) {
        data.passwordHash = await bcrypt.hash(parsed.data.password, config.bcryptCostFactor);
      }

      // Papel na org: actualiza membership; só sincroniza users.role se for o workspace activo.
      if (parsed.data.role !== undefined) {
        await ensureMembership({
          organizationId,
          userId: target.id,
          role: parsed.data.role,
        });
        if (target.organizationId === organizationId) {
          data.role = parsed.data.role;
        }
      }

      const user = await prisma.user.update({
        where: { id: target.id },
        data,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

      const membership = await getMembership(organizationId, user.id);
      const roleInOrg = membership?.role ?? user.role;

      if (roleInOrg === "AGENT") {
        await addAgentToAllOrganizationTeams(organizationId, user.id);
      }

      return {
        ...user,
        role: roleInOrg,
      };
    });

    adminApp.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      if (request.params.id === request.user.id) {
        return reply.status(400).send({ error: "Bad Request", message: "Cannot delete your own account", statusCode: 400 });
      }

      const target = await prisma.user.findFirst({
        where: { id: request.params.id, ...organizationMembersWhere(organizationId) },
        include: { memberships: true },
      });
      if (!target) {
        return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
      }

      const otherMemberships = target.memberships.filter((m) => m.organizationId !== organizationId);

      await prisma.$transaction(async (tx) => {
        await tx.organizationMembership.deleteMany({
          where: { organizationId, userId: target.id },
        });

        if (otherMemberships.length === 0) {
          // Sem outras orgs: remove a conta (comportamento anterior).
          await tx.user.delete({ where: { id: target.id } });
          return;
        }

        // Mantém a conta; se o workspace activo era esta org, muda para outra membership.
        if (target.organizationId === organizationId) {
          const next = otherMemberships[0]!;
          if (isOrgMemberRole(next.role)) {
            await tx.user.update({
              where: { id: target.id },
              data: { organizationId: next.organizationId, role: next.role },
            });
          }
        }
      });

      return reply.status(204).send();
    });
  });
}
