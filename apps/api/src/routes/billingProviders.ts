import type { FastifyInstance, FastifyReply } from "fastify";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isStripeBillingConfigured } from "../config.js";
import { handleMercadoPagoOAuthCallback } from "../lib/billing/MercadoPagoConnectionService.js";
import { getBillingProvidersClientConfig } from "../lib/billing/index.js";

function orgProviderConfigDisabled(reply: FastifyReply): void {
  reply.status(403).send({
    error: "platform_managed_billing",
    message: "Payment provider configuration is managed by the platform administrator",
    statusCode: 403,
  });
}

export async function billingProviderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/providers/mercadopago/oauth/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    const { redirectUrl } = await handleMercadoPagoOAuthCallback({
      code: q.code,
      state: q.state,
      error: q.error,
    });
    return reply.redirect(redirectUrl);
  });

  await app.register(async (admin) => {
    admin.addHook("preHandler", authenticate);
    admin.addHook("preHandler", requireAdmin);

    admin.get("/providers", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const providers = await getBillingProvidersClientConfig(organizationId);

      return {
        stripe: {
          ...providers.stripe,
          label: "Stripe",
          platformConfigured: isStripeBillingConfigured(),
        },
        mercadopago: {
          ...providers.mercadopago,
          label: "Mercado Pago",
          status: providers.mercadopago.connected ? "connected" : "disconnected",
          environment: "platform",
          hasAccessToken: providers.mercadopago.connected,
          externalUserId: null,
          externalUserIdMasked: null,
          connectedAt: null,
          lastError: null,
          oauthAvailable: false,
        },
        defaultProvider: "stripe" as const,
      };
    });

    admin.post("/providers/mercadopago/connect", async (_request, reply) => {
      orgProviderConfigDisabled(reply);
    });

    admin.post("/providers/mercadopago/oauth/start", async (_request, reply) => {
      orgProviderConfigDisabled(reply);
    });

    admin.post("/providers/mercadopago/test", async (_request, reply) => {
      orgProviderConfigDisabled(reply);
    });

    admin.delete("/providers/mercadopago", async (_request, reply) => {
      orgProviderConfigDisabled(reply);
    });
  });
}
