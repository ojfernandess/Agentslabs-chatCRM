import { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { requireAdmin } from "../middleware/auth.js";
import { isValidEmail } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { getWebAppPublicOrigin } from "../config.js";
import { getResendEmailConfigFromDb } from "../lib/resendEmailSettings.js";
import { sendUserInviteEmail } from "../lib/sendUserInviteEmail.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "AGENT"]).default("AGENT"),
});

function buildInviteUrl(token: string): string {
  return `${getWebAppPublicOrigin()}/login/invite?token=${encodeURIComponent(token)}`;
}

function invitationStatus(row: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): "pending" | "accepted" | "revoked" | "expired" {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt < new Date()) return "expired";
  return "pending";
}

export async function userInvitationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const rows = await prisma.userInvitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        invitedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: invitationStatus(row),
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      invitedBy: row.invitedBy,
    }));
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const email = parsed.data.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid email format", statusCode: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return reply.status(409).send({
        error: "Conflict",
        message: "User with this email already exists",
        statusCode: 409,
      });
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!org) {
      return reply.status(404).send({ error: "Not Found", message: "Organization not found", statusCode: 404 });
    }

    const cfg = await getResendEmailConfigFromDb();
    if (!cfg) {
      return reply.status(503).send({
        error: "Service Unavailable",
        message: "Transactional email is not configured",
        statusCode: 503,
      });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await prisma.userInvitation.upsert({
      where: { organizationId_email: { organizationId, email } },
      create: {
        organizationId,
        email,
        role: parsed.data.role,
        tokenHash,
        expiresAt,
        invitedById: request.user.id,
      },
      update: {
        role: parsed.data.role,
        tokenHash,
        expiresAt,
        acceptedAt: null,
        revokedAt: null,
        invitedById: request.user.id,
      },
    });

    const inviteUrl = buildInviteUrl(token);
    const sent = await sendUserInviteEmail(cfg, email, inviteUrl, org.name);
    if (!sent.ok) {
      request.log.error({ err: sent.error, inviteId: invite.id }, "user_invite_email_failed");
      return reply.status(502).send({
        error: "Bad Gateway",
        message: "Failed to send invitation email",
        statusCode: 502,
      });
    }

    return reply.status(201).send({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: invitationStatus(invite),
      expiresAt: invite.expiresAt.toISOString(),
      inviteUrl,
      createdAt: invite.createdAt.toISOString(),
    });
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const row = await prisma.userInvitation.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Invitation not found", statusCode: 404 });
    }
    if (row.acceptedAt) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Cannot revoke an accepted invitation",
        statusCode: 400,
      });
    }

    await prisma.userInvitation.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/regenerate-link", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const row = await prisma.userInvitation.findFirst({
      where: { id: request.params.id, organizationId },
      include: { organization: { select: { name: true } } },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Invitation not found", statusCode: 404 });
    }
    if (row.acceptedAt) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invitation already accepted",
        statusCode: 400,
      });
    }
    if (row.revokedAt) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invitation was revoked",
        statusCode: 400,
      });
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const updated = await prisma.userInvitation.update({
      where: { id: row.id },
      data: { tokenHash, expiresAt, revokedAt: null },
    });

    const inviteUrl = buildInviteUrl(token);
    return {
      id: updated.id,
      email: updated.email,
      inviteUrl,
      expiresAt: updated.expiresAt.toISOString(),
      status: invitationStatus(updated),
    };
  });
}
