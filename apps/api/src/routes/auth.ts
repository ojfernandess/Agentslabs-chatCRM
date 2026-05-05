import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { isValidEmail } from "@openconduit/shared";
import { clientIp, recordAuditLog } from "../lib/audit.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
        email: true,
        role: true,
        organizationId: true,
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
