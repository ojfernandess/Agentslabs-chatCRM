import type { FastifyInstance } from "fastify";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { canTenantAccessWhatsappConsumptionDashboard } from "../lib/whatsappConsumptionInsights.js";
import {
  getWhatsappConsumption,
  getWhatsappPolicyOverview,
  resolveConsumptionRange,
} from "../lib/whatsappOrgPolicy.js";

/**
 * Visualização da política Cloud Meta e dashboard de consumo WhatsApp por organização.
 * Não altera envio, janela ou cobrança — somente leitura.
 * Requer funcionalidade `whatsapp_consumption_dashboard` (modo visível na organização).
 */
export async function whatsappOrgPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/overview", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await canTenantAccessWhatsappConsumptionDashboard(organizationId))) {
      return reply.status(404).send({
        error: "Not Found",
        message: "whatsapp_consumption_dashboard_disabled",
        statusCode: 404,
      });
    }
    return getWhatsappPolicyOverview(organizationId);
  });

  app.get("/consumption", { preHandler: [requireAdmin] }, async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await canTenantAccessWhatsappConsumptionDashboard(organizationId))) {
      return reply.status(404).send({
        error: "Not Found",
        message: "whatsapp_consumption_dashboard_disabled",
        statusCode: 404,
      });
    }
    const q = request.query as Record<string, string | undefined>;
    const range = resolveConsumptionRange({
      preset: q.preset,
      from: q.from,
      to: q.to,
    });
    const categories = await getWhatsappConsumption({
      organizationId,
      from: range.from,
      to: range.to,
    });
    return {
      preset: range.preset,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      categories,
    };
  });
}
