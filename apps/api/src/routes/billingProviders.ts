import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isStripeBillingConfigured } from "../config.js";
import { BillingError } from "../lib/billing/StripeCustomerService.js";
import {
  connectMercadoPagoManual,
  disconnectMercadoPago,
  getMercadoPagoConnectionClientRow,
  handleMercadoPagoOAuthCallback,
  startMercadoPagoOAuth,
  testMercadoPagoConnection,
} from "../lib/billing/MercadoPagoConnectionService.js";
import {
  getBillingProvidersClientConfig,
} from "../lib/billing/index.js";

const connectManualSchema = z.object({
  accessToken: z.string().min(1).max(4096),
  publicKey: z.union([z.string().max(255), z.literal(""), z.null()]).optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
});

function sendBillingError(reply: FastifyReply, err: unknown): void {
  if (err instanceof BillingError) {
    reply.status(400).send({
      error: err.code,
      message: err.message,
      statusCode: 400,
    });
    return;
  }
  throw err;
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

      const [providers, mercadopago] = await Promise.all([
        getBillingProvidersClientConfig(organizationId),
        getMercadoPagoConnectionClientRow(organizationId),
      ]);

      return {
        stripe: {
          ...providers.stripe,
          label: "Stripe",
          platformConfigured: isStripeBillingConfigured(),
        },
        mercadopago: {
          ...providers.mercadopago,
          ...mercadopago,
          label: "Mercado Pago",
        },
        defaultProvider: "stripe" as const,
      };
    });

    admin.post("/providers/mercadopago/connect", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const body = connectManualSchema.parse(request.body ?? {});
      try {
        const connection = await connectMercadoPagoManual({
          organizationId,
          accessToken: body.accessToken,
          publicKey: body.publicKey,
          environment: body.environment,
        });
        return { ok: true, connection };
      } catch (err) {
        sendBillingError(reply, err);
        return;
      }
    });

    admin.post("/providers/mercadopago/oauth/start", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      try {
        return await startMercadoPagoOAuth(organizationId);
      } catch (err) {
        sendBillingError(reply, err);
        return;
      }
    });

    admin.post("/providers/mercadopago/test", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      try {
        return await testMercadoPagoConnection(organizationId);
      } catch (err) {
        sendBillingError(reply, err);
        return;
      }
    });

    admin.delete("/providers/mercadopago", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const connection = await disconnectMercadoPago(organizationId);
      return { ok: true, connection };
    });
  });
}
