import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  getUserSipCredentialsForClient,
  upsertUserSipCredentials,
} from "../lib/userSipCredentials.js";

const upsertSchema = z.object({
  sipUser: z.string().min(1).max(64),
  sipPassword: z.string().min(1).max(256),
  displayName: z.string().max(200).nullable().optional(),
});

export async function sipCredentialsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  async function requireEmbeddedSip(
    organizationId: string,
    reply: import("fastify").FastifyReply,
  ): Promise<boolean> {
    const enabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_embedded_sip");
    if (!enabled) {
      reply.status(403).send({
        error: "Forbidden",
        message: "nvoip_embedded_sip_disabled",
        statusCode: 403,
      });
      return false;
    }
    const voice = await isOrganizationFeatureEnabled(organizationId, "nvoip_voice");
    if (!voice) {
      reply.status(403).send({
        error: "Forbidden",
        message: "nvoip_voice_disabled",
        statusCode: 403,
      });
      return false;
    }
    return true;
  }

  app.get("/credentials", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;

    const creds = await getUserSipCredentialsForClient(request.user.id);
    if (!creds) {
      return reply.status(404).send({
        error: "Not Found",
        message: "sip_credentials_not_configured",
        statusCode: 404,
      });
    }
    return creds;
  });

  app.put("/credentials", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireEmbeddedSip(organizationId, reply))) return;

    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    try {
      await upsertUserSipCredentials({
        userId: request.user.id,
        sipUser: parsed.data.sipUser,
        sipPassword: parsed.data.sipPassword,
        displayName: parsed.data.displayName ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sip_credentials_invalid";
      return reply.status(400).send({ error: "Bad Request", message, statusCode: 400 });
    }

    return { ok: true };
  });
}
