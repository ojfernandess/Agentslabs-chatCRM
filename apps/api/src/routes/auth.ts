import { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { getOrganizationFeatureMap } from "../lib/featureFlags.js";
import { authenticate } from "../middleware/auth.js";
import { isValidEmail } from "@openconduit/shared";
import { clientIp, recordAuditLog } from "../lib/audit.js";
import { config, getWebAppPublicOrigin } from "../config.js";
import { getResendEmailConfigFromDb } from "../lib/resendEmailSettings.js";
import { sendPasswordResetEmail } from "../lib/sendPasswordResetEmail.js";
import {
  generateUserApiAccessTokenParts,
  hashUserApiAccessToken,
} from "../middleware/userApiTokenAuth.js";
import { addAgentToAllOrganizationTeams } from "../lib/agentScope.js";
import { addUserToDefaultInboxes } from "../lib/defaultInbox.js";
import { persistUserAvatarUpload } from "../lib/profileImageUpload.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const patchMeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  displayName: z.string().max(200).nullable().optional(),
  messageSignature: z.string().max(8000).nullable().optional(),
  showAgentNameInChat: z.boolean().optional(),
  avatarUrl: z.union([z.string().url().max(2048), z.literal(""), z.null()]).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  newPassword: z.string().min(8).max(128),
});

const acceptInviteSchema = z.object({
  token: z.string().min(16).max(512),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
});

function canManageProfileApiToken(user: {
  role: string;
  actingOrganizationId?: string | null;
}): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/forgot-password", async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid email format",
        statusCode: 400,
      });
    }
    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return { ok: true };
    }
    const cfg = await getResendEmailConfigFromDb();
    if (!cfg) {
      request.log.warn("password_reset_skipped_no_resend_config");
      return { ok: true };
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);
    const resetUrl = `${getWebAppPublicOrigin()}/login/reset?token=${encodeURIComponent(token)}`;
    const sent = await sendPasswordResetEmail(cfg, user.email, resetUrl, user.name);
    if (!sent.ok) {
      request.log.error({ err: sent.error }, "password_reset_email_failed");
    }
    return { ok: true };
  });

  app.post("/reset-password", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!row || row.expiresAt < new Date()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid or expired reset link",
        statusCode: 400,
      });
    }
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, config.bcryptCostFactor);
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: row.userId } }),
    ]);
    return { ok: true };
  });

  app.get("/invite", async (request, reply) => {
    const token = String((request.query as { token?: string }).token ?? "").trim();
    if (!token) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Missing token",
        statusCode: 400,
      });
    }
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const row = await prisma.userInvitation.findUnique({
      where: { tokenHash },
      include: { organization: { select: { name: true } } },
    });
    if (!row || row.revokedAt || row.acceptedAt || row.expiresAt < new Date()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid or expired invitation link",
        statusCode: 400,
      });
    }
    return {
      email: row.email,
      role: row.role,
      organizationName: row.organization.name,
    };
  });

  app.post("/accept-invite", async (request, reply) => {
    const parsed = acceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
    const row = await prisma.userInvitation.findUnique({
      where: { tokenHash },
    });
    if (!row || row.revokedAt || row.acceptedAt || row.expiresAt < new Date()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid or expired invitation link",
        statusCode: 400,
      });
    }

    const existing = await prisma.user.findUnique({ where: { email: row.email } });
    if (existing) {
      return reply.status(409).send({
        error: "Conflict",
        message: "An account with this email already exists",
        statusCode: 409,
      });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, config.bcryptCostFactor);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: row.organizationId,
          name: parsed.data.name.trim(),
          email: row.email,
          passwordHash,
          role: row.role,
        },
        select: { id: true, email: true, role: true, organizationId: true },
      });
      await tx.userInvitation.update({
        where: { id: row.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    if (user.role === "AGENT") {
      await addAgentToAllOrganizationTeams(row.organizationId, user.id);
    }
    await addUserToDefaultInboxes(row.organizationId, user.id);

    return { ok: true };
  });

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: "15 minutes",
          keyGenerator: (request) => `login:${request.ip}`,
        },
      },
    },
    async (request, reply) => {
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
  },
  );

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
        avatarUrl: true,
        email: true,
        role: true,
        organizationId: true,
        messageSignature: true,
        showAgentNameInChat: true,
        apiAccessTokenPrefix: true,
        apiAccessTokenHash: true,
        apiAccessTokenLastUsedAt: true,
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

    const orgId = actingId ?? user.organizationId ?? null;
    let organization: { id: string; name: string; slug: string } | null = null;
    if (orgId) {
      organization =
        actingOrganization && actingOrganization.id === orgId
          ? actingOrganization
          : await prisma.organization.findUnique({
              where: { id: orgId },
              select: { id: true, name: true, slug: true },
            });
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

    const orgIdForFeatures =
      user.role === "SUPER_ADMIN" ? actingId : user.organizationId;
    const organizationFeatures =
      orgIdForFeatures !== null && orgIdForFeatures !== undefined
        ? await getOrganizationFeatureMap(orgIdForFeatures)
        : undefined;

    return {
      ...user,
      role: user.role as string,
      actingOrganizationId: actingId,
      actingOrganization,
      organization,
      superAdminActorId,
      superAdminActor,
      organizationFeatures,
      hasApiAccessToken: !!user.apiAccessTokenHash,
      apiAccessTokenLastUsedAt: user.apiAccessTokenLastUsedAt,
      apiAccessTokenPrefix: user.apiAccessTokenPrefix,
    };
  });

  app.get("/me/access-token", { preHandler: [authenticate] }, async (request, reply) => {
    if (!canManageProfileApiToken(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required to manage profile API token",
        statusCode: 403,
      });
    }
    const user = await prisma.user.findUnique({
      where: { id: request.user.id },
      select: {
        id: true,
        apiAccessTokenPrefix: true,
        apiAccessTokenLastUsedAt: true,
        apiAccessTokenHash: true,
      },
    });
    if (!user) {
      return reply.status(404).send({ error: "Not Found", message: "User not found", statusCode: 404 });
    }
    return {
      configured: !!user.apiAccessTokenHash,
      prefix: user.apiAccessTokenPrefix,
      lastUsedAt: user.apiAccessTokenLastUsedAt,
    };
  });

  app.post("/me/access-token", { preHandler: [authenticate] }, async (request, reply) => {
    if (!canManageProfileApiToken(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required to manage profile API token",
        statusCode: 403,
      });
    }
    const { token, prefix } = generateUserApiAccessTokenParts();
    const hash = await hashUserApiAccessToken(token);
    await prisma.user.update({
      where: { id: request.user.id },
      data: {
        apiAccessTokenPrefix: prefix,
        apiAccessTokenHash: hash,
        apiAccessTokenLastUsedAt: null,
      },
    });
    return {
      token,
      prefix,
      message: "Save this token now. It will not be shown again.",
    };
  });

  app.delete("/me/access-token", { preHandler: [authenticate] }, async (request, reply) => {
    if (!canManageProfileApiToken(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required to manage profile API token",
        statusCode: 403,
      });
    }
    await prisma.user.update({
      where: { id: request.user.id },
      data: {
        apiAccessTokenPrefix: null,
        apiAccessTokenHash: null,
        apiAccessTokenLastUsedAt: null,
      },
    });
    return { ok: true };
  });

  app.post("/me/avatar", { preHandler: [authenticate] }, async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "multipart file field required",
        statusCode: 400,
      });
    }

    const mediaUrl = await persistUserAvatarUpload(file, request.user.id, reply);
    if (!mediaUrl) return;

    const updated = await prisma.user.update({
      where: { id: request.user.id },
      data: { avatarUrl: mediaUrl },
      select: { avatarUrl: true },
    });

    return { avatarUrl: updated.avatarUrl };
  });

  app.delete("/me/avatar", { preHandler: [authenticate] }, async (request) => {
    await prisma.user.update({
      where: { id: request.user.id },
      data: { avatarUrl: null },
    });
    return { avatarUrl: null };
  });

  app.patch("/me", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = patchMeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }
    const data: {
      name?: string;
      displayName?: string | null;
      messageSignature?: string | null;
      showAgentNameInChat?: boolean;
      avatarUrl?: string | null;
    } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
    if (parsed.data.messageSignature !== undefined) data.messageSignature = parsed.data.messageSignature;
    if (parsed.data.showAgentNameInChat !== undefined) data.showAgentNameInChat = parsed.data.showAgentNameInChat;
    if (parsed.data.avatarUrl !== undefined) {
      data.avatarUrl = parsed.data.avatarUrl === "" ? null : parsed.data.avatarUrl;
    }

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
