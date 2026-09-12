import { requirePermission } from "../access/permissions.js";
import { sanitizeForMcp } from "../security/sanitize.js";
import { syncEvolutionApiWebhookForInbox } from "../../evolutionPlatform.js";
import {
  searchWhatsappWebhookDiagnostics,
  WHATSAPP_MONITOR_PROVIDERS,
} from "../../whatsappWebhookDiagnostics.js";
import type { McpAuthContext, McpProviderSearchParams, McpResourceDescriptor } from "../types.js";
import type { McpProvider } from "./ProviderRegistry.js";

export const webhookProvider: McpProvider = {
  domain: "webhook",

  async listResources(ctx, params): Promise<McpResourceDescriptor[]> {
    requirePermission(ctx, "webhook:read");
    const result = await searchWhatsappWebhookDiagnostics({
      organizationId: ctx.organizationId,
      limit: params?.limit ?? 20,
    });
    return result.inboxes.map((inbox) => ({
      uri: `opennexo://webhook/${inbox.inboxId}`,
      name: `${inbox.inboxName} (${inbox.provider ?? "?"})`,
      description: inbox.receivingOk
        ? "Receiving inbound webhooks"
        : inbox.lastWebhookAttemptError ?? "No recent inbound",
      mimeType: "application/json",
    }));
  },

  async readResource(ctx, uri): Promise<unknown> {
    requirePermission(ctx, "webhook:read");
    const inboxId = uri.replace("opennexo://webhook/", "").trim();
    const result = await searchWhatsappWebhookDiagnostics({
      organizationId: ctx.organizationId,
      inboxId,
      includeEvolutionRemote: true,
    });
    const inbox = result.inboxes[0];
    if (!inbox) throw new Error("WhatsApp inbox not found");
    return sanitizeForMcp(inbox);
  },

  async search(ctx, params): Promise<unknown> {
    requirePermission(ctx, "webhook:read");
    const inboxId = params.inboxId?.trim();
    const provider = params.provider?.trim().toLowerCase();
    if (provider && !WHATSAPP_MONITOR_PROVIDERS.includes(provider as (typeof WHATSAPP_MONITOR_PROVIDERS)[number])) {
      throw new Error(
        `Invalid provider "${provider}". Use: ${WHATSAPP_MONITOR_PROVIDERS.join(", ")}`,
      );
    }

    const result = await searchWhatsappWebhookDiagnostics({
      organizationId: ctx.organizationId,
      inboxId,
      provider,
      errorOnly: params.errorOnly,
      limit: params.limit,
      includeEvolutionRemote: true,
    });

    let evolutionResync: { ok: boolean; status?: number; body?: string } | null = null;
    const targetInbox = result.inboxes[0];
    if (
      params.resyncEvolutionWebhook &&
      inboxId &&
      targetInbox?.provider === "evolution"
    ) {
      const wh = await syncEvolutionApiWebhookForInbox(ctx.organizationId, inboxId);
      evolutionResync =
        wh?.ok === true
          ? { ok: true }
          : {
              ok: false,
              status: wh && "status" in wh ? wh.status : undefined,
              body: wh && "body" in wh ? wh.body.slice(0, 300) : undefined,
            };
    }

    return sanitizeForMcp({
      ...result,
      monitoredProviders: [...WHATSAPP_MONITOR_PROVIDERS],
      evolutionResync,
    });
  },
};
