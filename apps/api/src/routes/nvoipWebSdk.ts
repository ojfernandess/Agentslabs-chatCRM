import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  confirmNvoipWebSdkVerification,
  normalizeWebSdkChannel,
  normalizeWebSdkFlow,
  resolveNvoipWebSdkChannels,
  startNvoipWebSdkVerification,
} from "../lib/nvoipWebSdkAuth.js";

async function requireNvoipOtp(organizationId: string, reply: import("fastify").FastifyReply) {
  const enabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_otp");
  if (!enabled) {
    reply.status(403).send({
      error: "Forbidden",
      message: "nvoip_otp_disabled",
      statusCode: 403,
    });
    return false;
  }
  return true;
}

export async function nvoipWebSdkRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/config", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipOtp(organizationId, reply))) return;

    const channels = await resolveNvoipWebSdkChannels(organizationId);
    return {
      flow: "otp",
      channels,
    };
  });

  app.post("/auth/start", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipOtp(organizationId, reply))) return;

    const body = z
      .object({
        phone: z.string().min(8),
        channel: z.string().optional(),
        flow: z.string().optional(),
        contactId: z.string().uuid().optional(),
        purpose: z.enum(["contact_phone_verify", "user_2fa", "admin_test"]).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const channel = normalizeWebSdkChannel(body.data.channel) ?? "sms";
    const flow = normalizeWebSdkFlow(body.data.flow);

    try {
      const result = await startNvoipWebSdkVerification({
        organizationId,
        phone: body.data.phone,
        channel,
        flow,
        purpose: body.data.purpose,
        contactId: body.data.contactId ?? null,
        userId: request.user.id,
        actorUserId: request.user.id,
      });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "otp_send_failed",
        statusCode: 400,
      });
    }
  });

  app.post("/auth/confirm", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipOtp(organizationId, reply))) return;

    const body = z
      .object({
        sessionId: z.string().min(1),
        code: z.string().min(1).max(16),
        channel: z.string().optional(),
        flow: z.string().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const channel = normalizeWebSdkChannel(body.data.channel) ?? "sms";
    const flow = normalizeWebSdkFlow(body.data.flow);

    try {
      const result = await confirmNvoipWebSdkVerification({
        organizationId,
        sessionId: body.data.sessionId,
        code: body.data.code,
        channel,
        flow,
      });
      if (!result.ok) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "otp_invalid_code",
          statusCode: 400,
        });
      }
      return { ok: true, status: result.status ?? "verified" };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "otp_verify_failed",
        statusCode: 400,
      });
    }
  });
}
