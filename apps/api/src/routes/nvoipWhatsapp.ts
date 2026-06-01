import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  getNvoipWhatsappAvailability,
  listNvoipWhatsappTemplates,
} from "../lib/nvoipWhatsapp.js";

export async function nvoipWhatsappRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/status", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return getNvoipWhatsappAvailability(organizationId);
  });

  app.get("/templates", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const availability = await getNvoipWhatsappAvailability(organizationId);
    if (!availability.available) {
      return reply.status(403).send({
        error: "Forbidden",
        message: availability.blockedReason ?? "nvoip_whatsapp_unavailable",
        statusCode: 403,
        ...availability,
      });
    }

    try {
      const data = await listNvoipWhatsappTemplates(organizationId);
      return { data };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "list_templates_failed",
        statusCode: 400,
      });
    }
  });
}
