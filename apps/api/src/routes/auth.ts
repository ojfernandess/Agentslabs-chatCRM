import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { isValidEmail } from "@openconduit/shared";
import { clientIp, recordAuditLog } from "../lib/audit.js";
import { config } from "../config.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const patchMeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  displayName: z.string().max(200).nullable().optional(),
  messageSignature: z.string().max(8000).nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid email or password format",
        statusCode: 400,
      });
    }

    const { email, password } = parsed.data;

    if (!isValidEmail(email)) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid email format",
        statusCode: 400,
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid credentials",
        statusCode: 401,
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid credentials",
        statusCode: 401,
      });
    }

    const token = app.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as string,
        organizationId: user.organizationId,
      },
    };
  });

  app.post("/logout", { preHandler: [authenticate] }, async () => {
    return { message: "Logged out" };
  });

  app.get("/me", { preHandler: [authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        name: true,
        displayName: true,
        email: true,
        role: true,
        organizationId: true,
        messageSignature: true,
        createdAt: true,
      },
    });
    if (!user) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }

    const actingId = request.user.actingOrganizationId ?? null;
    let actingOrganization: { id: string; name: string; slug: string } | null = null;
    if (actingId) {
      const org = await prisma.organization.findUnique({
        where: { id: actingId },
        select: { id: true, name: true, slug: true },
      });
      if (org) actingOrganization = org;
    }

    const superAdminActorId = request.user.superAdminActorId ?? null;
    let superAdminActor: { id: string; email: string; name: string } | null = null;
    if (superAdminActorId) {
      const actor = await prisma.user.findUnique({
        where: { id: superAdminActorId },
        select: { id: true, email: true, name: true, role: true },
      });
      if (actor?.role === "SUPER_ADMIN") {
        superAdminActor = { id: actor.id, email: actor.email, name: actor.name };
      }
    }

    return {
      ...user,
      role: user.role as string,
      actingOrganizationId: actingId,
      actingOrganization,
      superAdminActorId,
      superAdminActor,
    };
  });

  app.patch("/me", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = patchMeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const data: { name?: string; displayName?: string | null; messageSignature?: string | null } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.messageSignature !== undefined) data.messageSignature = parsed.data.messageSignature;

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Bad Request", message: "No fields to update", statusCode: 400 });
    }

    await prisma.user.update({
      where: { id: request.user.id },
      data,
    });

    return { success: true };
  });

  app.post("/me/password", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const user = await prisma.user.findUnique({ where: { id: request.user.id } });
    if (!user) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }
    const ok = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!ok) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Current password is incorrect",
        statusCode: 400,
      });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, config.bcryptCostFactor);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    return { ok: true };
  });

  /** Termina impersonação de utilizador (JWT com `superAdminActorId`); emite token do super admin. */
  app.post("/exit-user-impersonation", { preHandler: [authenticate] }, async (request, reply) => {
    const actorId = request.user.superAdminActorId;
    const impersonatedId = request.user.id;
    if (!actorId) {
      return reply
        .status(400)
        .send({ error: "Bad Request", message: "Not in user impersonation mode", statusCode: 400 });
    }

    const superUser = await prisma.user.findFirst({
      where: { id: actorId, role: "SUPER_ADMIN" },
    });
    if (!superUser) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Invalid impersonation session",
        statusCode: 403,
      });
    }

    const token = app.jwt.sign({
      id: superUser.id,
      email: superUser.email,
      role: superUser.role,
      organizationId: superUser.organizationId,
    });

    try {
      await recordAuditLog({
        actorUserId: superUser.id,
        organizationId: request.user.organizationId ?? null,
        action: "super.user.impersonate.exit",
        resourceType: "user",
        resourceId: impersonatedId,
        ip: clientIp(request),
      });
    } catch {
      /* audit best-effort */
    }

    return { token };
  });
}
