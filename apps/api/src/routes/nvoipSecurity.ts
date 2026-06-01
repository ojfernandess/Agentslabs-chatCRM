import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { requireConnectedNvoipAccount } from "../lib/nvoipSms.js";
import { nvoipCheck2fa, nvoipSend2fa } from "../lib/nvoipClient.js";
import { writeNvoipIntegrationLog } from "../lib/nvoipIntegrationLog.js";

export async function nvoipSecurityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const otpEnabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_otp");
    if (!otpEnabled) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "nvoip_otp_disabled",
        statusCode: 403,
      });
    }
  });

  app.post("/2fa/send", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const row = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!row || row.otpProvider !== "NVOIP") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "otp_provider_not_configured",
        statusCode: 400,
      });
    }

    try {
      const connected = await requireConnectedNvoipAccount(organizationId);
      const result = await nvoipSend2fa(connected);
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: connected.id,
        level: "info",
        eventType: "2fa_sent",
        message: `2FA PIN requested by user ${request.user.id}`,
      });
      return { token2fa: result.token2fa };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "2fa_send_failed",
        statusCode: 400,
      });
    }
  });

  app.post("/2fa/verify", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = z
      .object({
        token2fa: z.string().min(1).max(256),
        pin: z.string().min(4).max(12),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    try {
      const account = await requireConnectedNvoipAccount(organizationId);
      const result = await nvoipCheck2fa(account, parsed.data);
      return { ok: result.ok };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "2fa_verify_failed",
        statusCode: 400,
      });
    }
  });
}
