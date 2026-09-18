import type { FastifyInstance } from "fastify";
import { authenticateSessionOrUserApiTokenForApplicationApis } from "../middleware/auth.js";
import { enforceApiEndpointRateLimit } from "../lib/apiEndpointRateLimit.js";
import { replyPlanEnforcementError } from "../lib/billing/planEnforcement.js";
import {
  executeExternalSendTemplate,
  externalSendTemplateBodySchema,
  mapExternalSendTemplateError,
  normalizeExternalSendTemplatePayload,
  resolveExternalSendTemplateOrganizationId,
} from "../lib/externalSendTemplate.js";

function isTenantAdminLike(user: { role: string; actingOrganizationId?: string | null }): boolean {
  return user.role === "ADMIN" || (user.role === "SUPER_ADMIN" && !!user.actingOrganizationId);
}

/**
 * Integrações externas (automações de clientes) — autenticação `ocu_` ou JWT admin.
 * Base: `/api/v1`
 */
export async function externalAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/sendTemplate",
    {
      preHandler: [
        authenticateSessionOrUserApiTokenForApplicationApis,
        enforceApiEndpointRateLimit("send_template"),
      ],
    },
    async (request, reply) => {
    if (!isTenantAdminLike(request.user)) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Admin access required for external template send",
        statusCode: 403,
      });
    }

    const parsed = externalSendTemplateBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.status(400).send({
        error: "Bad Request",
        message: first?.message ?? parsed.error.message,
        statusCode: 400,
      });
    }

    const payload = normalizeExternalSendTemplatePayload(parsed.data);
    const orgResult = await resolveExternalSendTemplateOrganizationId(request.user, payload.organizationId);
    if ("statusCode" in orgResult) {
      return reply.status(orgResult.statusCode).send({
        error: orgResult.statusCode === 400 ? "Bad Request" : "Forbidden",
        message: orgResult.message,
        statusCode: orgResult.statusCode,
      });
    }

    try {
      const result = await executeExternalSendTemplate({
        organizationId: orgResult.organizationId,
        userId: request.user.id,
        payload,
        log: request.log,
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (replyPlanEnforcementError(reply, err)) return;
      const mapped = mapExternalSendTemplateError(err);
      return reply.status(mapped.statusCode).send({
        error: mapped.statusCode === 500 ? "Internal Server Error" : mapped.statusCode === 422 ? "Unprocessable Entity" : mapped.statusCode === 404 ? "Not Found" : mapped.statusCode === 403 ? "Forbidden" : "Bad Request",
        message: mapped.message,
        statusCode: mapped.statusCode,
      });
    }
  });
}
