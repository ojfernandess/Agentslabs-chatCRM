import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { getWhatsAppProviderForInbox, getWebhookSecretForInbox } from "../providers/factory.js";
import { recordWhatsappWebhookAttempt, resolveWhatsappWebhookTarget } from "../lib/whatsappWebhookRouting.js";
import { extractMetaWebhookPhoneNumberId, isMetaCloudWebhookPayload } from "../lib/metaWebhookPayload.js";
import { MetaCloudApiProvider } from "../providers/meta.js";
import { getWhatsAppEmbeddedConfig } from "../lib/metaWhatsAppEmbedded.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  findOrganizationByMetaPhoneNumberId,
  findWhatsappInboxByProvider,
  resolveInboxWhatsappCredentials,
} from "../lib/inboxWhatsappConfig.js";
import {
  evolutionGoWebhookMatchesOrgInstance,
  findEvolutionGoWhatsappInboxId,
  isEvolutionApiWebhookPayload,
  isEvolutionGoWebhookPayload,
} from "../lib/evolutionGoPlatform.js";
import { handleWavoipWebhook, verifyWavoipWebhookSecret } from "../lib/wavoipWebhookHandler.js";
import { logWavoipIntegration } from "../lib/wavoipIntegrationLog.js";
import { handleNvoipDtmfWebhook } from "../lib/nvoipDtmfWebhook.js";
import { handleNvoipCallWebhook } from "../lib/nvoipCallWebhook.js";
import { verifyNvoipCallWebhookSecret } from "../lib/nvoipWebhookSecret.js";
import {
  assertOrganizationMercadoPagoWebhookSignature,
  loadOrganizationMercadoPagoToolForWebhook,
  OrganizationMercadoPagoWebhookError,
  processOrganizationMercadoPagoToolWebhook,
} from "../lib/mercadoPagoToolWebhookHandler.js";
import {
  constructOrganizationStripeWebhookEvent,
  OrganizationStripeWebhookError,
  processOrganizationStripeToolWebhook,
  loadOrganizationStripeToolForWebhook,
} from "../lib/stripeToolWebhookHandler.js";
import {
  constructStripeWebhookEvent,
  processStripeWebhookEvent,
  StripeWebhookError,
} from "../lib/billing/stripeWebhookHandler.js";
import {
  assertMercadoPagoWebhookSignature,
  MercadoPagoWebhookError,
  processMercadoPagoWebhookNotification,
  type MercadoPagoWebhookNotification,
} from "../lib/billing/mercadopago/mercadoPagoWebhookHandler.js";
import { config, isStripeBillingConfigured, isMercadoPagoWebhookConfigured } from "../config.js";
import { processWhatsAppWebhookEvents } from "../lib/whatsappInboundProcessor.js";
import {
  enqueueMetaInboundWebhookJob,
  isMetaInboundQueueAvailable,
  shouldQueueMetaInboundWebhook,
} from "../lib/metaInboundQueue.js";

type WebhookRequest = FastifyRequest & { rawBody?: string };

/** Captura o corpo bruto para validar X-Hub-Signature-256 (Meta) com os bytes originais. */
async function captureWebhookRawBody(
  request: FastifyRequest,
  _reply: FastifyReply,
  payload: AsyncIterable<Buffer | string>,
): Promise<Readable> {
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  (request as WebhookRequest).rawBody = raw;
  return Readable.from([raw]);
}

const webhookPostOpts = { preParsing: captureWebhookRawBody };

/** Sufixos quando Evolution usa webhook_by_events: https://doc.evolution-api.com/v2/en/configuration/webhooks */
const WHATSAPP_POST_SUFFIXES = [
  "",
  "/messages-upsert",
  "/messages-update",
  "/messages-delete",
  "/messages-set",
  "/send-message",
  "/contacts-update",
  "/contacts-upsert",
  "/contacts-set",
  "/chats-update",
  "/chats-upsert",
  "/chats-set",
  "/chats-delete",
  "/connection-update",
  "/qrcode-updated",
  "/presence-update",
  "/groups-upsert",
  "/groups-update",
  "/group-participants-update",
  "/application-startup",
  "/new-jwt",
] as const;

function normalizeJsonBody(body: unknown): unknown {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  return body;
}

async function handleWhatsAppPost(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  organizationId: string,
  options?: { inboxId?: string; skipWebhookSignature?: boolean },
): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isActive: true },
  });
  if (!org?.isActive) {
    app.log.warn({ organizationId }, "Webhook ignored: organization suspended");
    return reply.status(503).send();
  }

  app.log.info(
    {
      url: request.url,
      contentLength: request.headers["content-length"],
      organizationId,
      inboxId: options?.inboxId,
    },
    "WhatsApp webhook POST received",
  );

  let body = normalizeJsonBody(request.body);
  if (body === null) {
    return reply.status(400).send({ error: "Invalid JSON body" });
  }

  let resolvedInboxId = options?.inboxId;
  // Evolution API e Evolution Go partilham campos em `data` — nunca forçar Go em MESSAGES_*.
  if (isEvolutionApiWebhookPayload(body)) {
    const evoApiInbox = await findWhatsappInboxByProvider(organizationId, "evolution");
    if (evoApiInbox) resolvedInboxId = evoApiInbox.id;
  } else if (isEvolutionGoWebhookPayload(body)) {
    const evoInbox = await findEvolutionGoWhatsappInboxId(organizationId);
    if (evoInbox) resolvedInboxId = evoInbox;
  }

  const attemptInboxId = resolvedInboxId;
  if (attemptInboxId) {
    void recordWhatsappWebhookAttempt(attemptInboxId, "received").catch((err) =>
      app.log.warn({ err, inboxId: attemptInboxId }, "Failed to record WhatsApp webhook attempt"),
    );
  }

  const target = await resolveWhatsappWebhookTarget(
    organizationId,
    {
      inboxId: resolvedInboxId,
      body,
    },
    app.log,
  );
  if (!target) {
    app.log.warn({ organizationId }, "Webhook received but no WhatsApp inbox/provider resolved");
    if (attemptInboxId) {
      void recordWhatsappWebhookAttempt(attemptInboxId, "rejected", "no_inbox_target").catch((err) =>
        app.log.warn({ err, inboxId: attemptInboxId }, "Failed to record WhatsApp webhook attempt"),
      );
    }
    return reply.status(200).send();
  }

  if (target.whatsappProvider === "evolution_go" || isEvolutionGoWebhookPayload(body)) {
    const inboxRow = await prisma.inbox.findFirst({
      where: { id: target.inboxId, organizationId },
      select: {
        channelConfig: true,
        channelType: true,
        whatsappPhoneNumberId: true,
        isDefault: true,
      },
    });
    const inboxCreds = inboxRow
      ? await resolveInboxWhatsappCredentials(organizationId, inboxRow)
      : null;
    const orgSettings = await prisma.settings.findUnique({
      where: { organizationId },
      select: { whatsappPhoneNumberId: true, whatsappApiKey: true, whatsappProvider: true },
    });
    const matchSettings = {
      whatsappPhoneNumberId:
        inboxCreds?.whatsappPhoneNumberId ?? orgSettings?.whatsappPhoneNumberId ?? null,
      whatsappApiKey: inboxCreds?.whatsappApiKey ?? orgSettings?.whatsappApiKey ?? null,
    };
    if (
      (target.whatsappProvider === "evolution_go" || isEvolutionGoWebhookPayload(body)) &&
      !evolutionGoWebhookMatchesOrgInstance(body, matchSettings, organizationId)
    ) {
      app.log.info(
        {
          organizationId,
          inboxId: target.inboxId,
          payloadInstanceId: (body as Record<string, unknown>)?.instanceId,
          payloadInstance: (body as Record<string, unknown>)?.instance,
        },
        "Evolution Go webhook ignored: instance in payload does not match organization instance",
      );
      return reply.status(200).send();
    }
  }

  const provider = await getWhatsAppProviderForInbox(organizationId, target.inboxId);
  if (!provider) {
    app.log.warn(
      { organizationId, inboxId: target.inboxId },
      "Webhook received but provider could not be built for inbox",
    );
    return reply.status(200).send();
  }

  const secret = await getWebhookSecretForInbox(organizationId, target.inboxId);
  if (!options?.skipWebhookSignature) {
    const rawBody =
      (request as WebhookRequest).rawBody ??
      (typeof request.body === "string" ? request.body : JSON.stringify(request.body));
    const providerNeedsSignature =
      target.whatsappProvider === "meta" || target.whatsappProvider === "360dialog";
    const isEvolutionFamily =
      target.whatsappProvider === "evolution" || target.whatsappProvider === "evolution_go";
    const embeddedCfg = providerNeedsSignature ? await getWhatsAppEmbeddedConfig() : null;
    const hasAnySecret = Boolean(secret?.trim() || embeddedCfg?.appSecret?.trim());
    const headers = request.headers as Record<string, string | undefined>;
    const hasOpenconduitToken = Boolean(headers["x-openconduit-token"]?.trim());
    const bodyRec =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null;
    const hasEvolutionGoInstanceToken = Boolean(
      typeof bodyRec?.instanceToken === "string" && bodyRec.instanceToken.trim(),
    );
    // Secret opcional na Evolution: só exigir quando o pedido traz material de auth.
    // Caso contrário um App Secret Meta legado na inbox bloqueava todos os inbound.
    const evolutionOptionalSecretIdle =
      isEvolutionFamily &&
      Boolean(secret?.trim()) &&
      !hasOpenconduitToken &&
      !(target.whatsappProvider === "evolution_go" && hasEvolutionGoInstanceToken);

    if (providerNeedsSignature && !hasAnySecret) {
      app.log.warn(
        { organizationId, inboxId: target.inboxId, provider: target.whatsappProvider },
        "Webhook rejected: Meta/360dialog webhook secret not configured",
      );
      void recordWhatsappWebhookAttempt(target.inboxId, "rejected", "secret_not_configured").catch((err) =>
        app.log.warn({ err, inboxId: target.inboxId }, "Failed to record WhatsApp webhook attempt"),
      );
      return reply.status(503).send({ error: "Webhook secret not configured" });
    }

    if ((secret || providerNeedsSignature) && !evolutionOptionalSecretIdle) {
      let valid = false;
      if (secret) {
        valid = provider.validateWebhookSignature(headers, rawBody, secret);
      }

      if (
        !valid &&
        (target.whatsappProvider === "meta" || target.whatsappProvider === "360dialog") &&
        embeddedCfg?.appSecret
      ) {
        valid = provider.validateWebhookSignature(headers, rawBody, embeddedCfg.appSecret);
        if (valid) {
          app.log.info(
            { organizationId, inboxId: target.inboxId },
            "Webhook signature validated with platform embedded app secret",
          );
        }
      }

      if (!valid) {
        app.log.warn(
          {
            organizationId,
            inboxId: target.inboxId,
            provider: target.whatsappProvider,
          },
          target.whatsappProvider === "meta" || target.whatsappProvider === "360dialog"
            ? "Webhook signature validation failed — use Meta App Secret in whatsappWebhookSecret (not the verify token)"
            : "Webhook signature validation failed",
        );
        void recordWhatsappWebhookAttempt(target.inboxId, "rejected", "invalid_signature").catch((err) =>
          app.log.warn({ err, inboxId: target.inboxId }, "Failed to record WhatsApp webhook attempt"),
        );
        return reply.status(401).send({ error: "Invalid signature" });
      }
    } else if (evolutionOptionalSecretIdle) {
      app.log.info(
        { organizationId, inboxId: target.inboxId, provider: target.whatsappProvider },
        "Evolution webhook: optional secret configured but no auth material on request — accepting",
      );
    }
  }

  const { messages, statusUpdates, reactionUpdates = [], contactSync } = provider.parseWebhook(
    request.headers as Record<string, string | undefined>,
    body,
  );

  if (
    messages.length === 0 &&
    statusUpdates.length === 0 &&
    reactionUpdates.length === 0 &&
    (!contactSync || contactSync.length === 0) &&
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    const env = body as Record<string, unknown>;
    if (isMetaCloudWebhookPayload(body)) {
      app.log.warn(
        {
          organizationId,
          inboxId: target.inboxId,
          provider: target.whatsappProvider,
        },
        "Meta Cloud webhook: payload received but no messages parsed — confirm webhook URL matches this inbox and phone_number_id is configured",
      );
    } else if (target.whatsappProvider === "evolution") {
      app.log.warn(
        {
          event: env.event,
          url: request.url,
          organizationId,
        },
        "Evolution webhook: nothing parsed — enable MESSAGES_UPSERT, MESSAGES_UPDATE and CONTACTS_* on the instance webhook; POST URL must be https://<seu-dominio>/webhooks/whatsapp/<uuid-da-organizacao> (Evolution may append /messages-upsert if webhook by events is enabled).",
      );
    } else if (target.whatsappProvider === "evolution_go") {
      app.log.warn(
        {
          event: env.event,
          url: request.url,
          organizationId,
        },
        "Evolution Go webhook: nothing parsed — use POST /instance/connect with webhookUrl https://<seu-dominio>/webhooks/whatsapp/<uuid-da-organizacao> and subscribe ALL; inbound events must be Message (not Evolution API v2 MESSAGES_UPSERT).",
      );
    }
  }

  const useMetaInboundQueue =
    config.metaInboundQueueEnabled &&
    isMetaInboundQueueAvailable() &&
    shouldQueueMetaInboundWebhook({
      whatsappProvider: target.whatsappProvider,
      messages,
      contactSync,
    });

  if (useMetaInboundQueue) {
    const enqueueStarted = Date.now();
    await processWhatsAppWebhookEvents({
      app,
      organizationId,
      target,
      body,
      messages,
      statusUpdates,
      reactionUpdates,
      contactSync,
      scope: "status_reactions",
    });
    const enqueued = await enqueueMetaInboundWebhookJob({
      organizationId,
      inboxId: target.inboxId,
      whatsappProvider: target.whatsappProvider,
      body,
      receivedAt: new Date().toISOString(),
      messageWaIds: messages.map((m) => m.waMessageId).filter((id): id is string => Boolean(id?.trim())),
    });
    if (enqueued) {
      const httpMs = Date.now() - enqueueStarted;
      const { recordLatencySample } = await import("../lib/platform-observability/latencySampler.js");
      recordLatencySample("meta_webhook_http", httpMs);
      app.log.info(
        {
          organizationId,
          inboxId: target.inboxId,
          messageCount: messages.length,
          httpMs,
        },
        "Meta inbound webhook enqueued (early 200)",
      );
      return reply.status(200).send();
    }
    app.log.warn(
      { organizationId, inboxId: target.inboxId },
      "Meta inbound queue enqueue failed — sync fallback",
    );
  }

  await processWhatsAppWebhookEvents({
    app,
    organizationId,
    target,
    body,
    messages,
    statusUpdates,
    reactionUpdates,
    contactSync,
    scope: "all",
  });
  return reply.status(200).send();
}


export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/meta/whatsapp", async (request, reply) => {
    const cfg = await getWhatsAppEmbeddedConfig();
    if (!cfg) {
      return reply.status(503).send({ error: "WhatsApp Embedded not configured" });
    }
    const q = request.query as Record<string, string | undefined>;
    const mode = q["hub.mode"];
    const token = q["hub.verify_token"];
    const challenge = q["hub.challenge"];
    if (mode === "subscribe" && token === cfg.webhookVerifyToken && challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.status(403).send({ error: "Verification failed" });
  });

  app.post("/meta/whatsapp", webhookPostOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    const cfg = await getWhatsAppEmbeddedConfig();
    if (!cfg) {
      return reply.status(503).send();
    }
    const body = normalizeJsonBody(request.body);
    if (body === null) {
      return reply.status(400).send({ error: "Invalid JSON body" });
    }
    const rawBody =
      (request as WebhookRequest).rawBody ??
      (typeof request.body === "string" ? request.body : JSON.stringify(request.body));
    const metaVerifier = new MetaCloudApiProvider("unused", "unused");
    const valid = metaVerifier.validateWebhookSignature(
      request.headers as Record<string, string | undefined>,
      rawBody,
      cfg.appSecret,
    );
    if (!valid) {
      app.log.warn("meta/whatsapp webhook signature validation failed");
      return reply.status(401).send({ error: "Invalid signature" });
    }
    const phoneId = extractMetaWebhookPhoneNumberId(body);
    if (!phoneId) {
      app.log.info({ url: request.url }, "meta/whatsapp: no phone_number_id in payload");
      return reply.status(200).send();
    }
    const hit = await findOrganizationByMetaPhoneNumberId(phoneId);
    if (!hit) {
      app.log.warn({ phoneId }, "meta/whatsapp: no organization for phone_number_id");
      return reply.status(200).send();
    }
    if (!hit.inboxId) {
      app.log.warn(
        { phoneId, organizationId: hit.organizationId },
        "meta/whatsapp: organization found but no WhatsApp inbox — create/configure a Meta inbox",
      );
      return reply.status(200).send();
    }
    return handleWhatsAppPost(app, request, reply, hit.organizationId, {
      inboxId: hit.inboxId,
      skipWebhookSignature: true,
    });
  });

  async function handleWhatsAppGet(
    organizationId: string,
    inboxId: string | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { isActive: true },
    });
    if (!org?.isActive) {
      return reply.status(503).send({ error: "Organization suspended" });
    }

    const target = await resolveWhatsappWebhookTarget(organizationId, { inboxId });
    if (!target) {
      return reply.status(503).send({ error: "Provider not configured" });
    }

    const provider = await getWhatsAppProviderForInbox(organizationId, target.inboxId);
    if (!provider) {
      return reply.status(503).send({ error: "Provider not configured" });
    }

    const challenge = provider.handleVerification(request.query as Record<string, string>);
    if (challenge) {
      return reply.type("text/plain").send(challenge);
    }
    return reply.status(403).send({ error: "Verification failed" });
  }

  app.get<{ Params: { organizationId: string; inboxId: string } }>(
    "/whatsapp/:organizationId/:inboxId",
    async (request, reply) => {
      return handleWhatsAppGet(request.params.organizationId, request.params.inboxId, request, reply);
    },
  );

  app.get<{ Params: { organizationId: string } }>("/whatsapp/:organizationId", async (request, reply) => {
    return handleWhatsAppGet(request.params.organizationId, undefined, request, reply);
  });

  for (const suffix of WHATSAPP_POST_SUFFIXES) {
    app.post<{ Params: { organizationId: string; inboxId: string } }>(
      `/whatsapp/:organizationId/:inboxId${suffix}`,
      webhookPostOpts,
      async (
        request: FastifyRequest<{ Params: { organizationId: string; inboxId: string } }>,
        reply: FastifyReply,
      ) => {
        return handleWhatsAppPost(app, request, reply, request.params.organizationId, {
          inboxId: request.params.inboxId,
        });
      },
    );
    app.post<{ Params: { organizationId: string } }>(
      `/whatsapp/:organizationId${suffix}`,
      webhookPostOpts,
      async (
        request: FastifyRequest<{ Params: { organizationId: string } }>,
        reply: FastifyReply,
      ) => {
        return handleWhatsAppPost(app, request, reply, request.params.organizationId);
      },
    );
  }

  app.post<{ Params: { organizationId: string; deviceId: string } }>(
    "/wavoip/:organizationId/:deviceId",
    webhookPostOpts,
    async (request, reply) => {
      const device = await prisma.wavoipDevice.findFirst({
        where: {
          id: request.params.deviceId,
          organizationId: request.params.organizationId,
        },
      });
      if (!device) {
        return reply.status(404).send({ error: "Not Found", message: "Device not found", statusCode: 404 });
      }

      // Webhook CRM (conversa, timeline, WS) corre sempre que o device existe; a flag só bloqueia UI/API de agente.
      const wavoipUiDisabled = !(await isOrganizationFeatureEnabled(
        request.params.organizationId,
        "wavoip_voice",
      ));
      if (wavoipUiDisabled) {
        await logWavoipIntegration({
          organizationId: request.params.organizationId,
          wavoipDeviceId: device.id,
          level: "info",
          eventType: "webhook_flag_ui_off",
          message:
            "Webhook processed with wavoip_voice off for UI; enable in Super Admin > Funcionalidades for agent voice shell.",
        });
      }

      const headerSecret =
        (request.headers["x-wavoip-webhook-secret"] as string | undefined) ??
        (request.headers["x-openconduit-token"] as string | undefined);

      if (!verifyWavoipWebhookSecret(device, headerSecret)) {
        return reply.status(401).send({ error: "Unauthorized", message: "Invalid webhook secret", statusCode: 401 });
      }

      const body = normalizeJsonBody(request.body);
      if (body === null) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid JSON body", statusCode: 400 });
      }

      try {
        const result = await handleWavoipWebhook(
          app,
          request.params.organizationId,
          request.params.deviceId,
          body,
        );
        if (!result.ok) {
          return reply.status(result.status).send({
            error: result.status === 404 ? "Not Found" : "Error",
            message: result.message,
            statusCode: result.status,
          });
        }
        return { ok: true };
      } catch {
        return reply.status(500).send({ error: "Internal Server Error", message: "Webhook failed", statusCode: 500 });
      }
    },
  );

  app.post<{ Params: { organizationId: string } }>(
    "/nvoip/:organizationId",
    async (request, reply) => {
      const account = await prisma.nvoipAccount.findFirst({
        where: { organizationId: request.params.organizationId, status: "CONNECTED" },
        select: { externalConfig: true },
      });
      if (!account) {
        return reply.status(404).send({
          error: "Not Found",
          message: "nvoip_account_not_found",
          statusCode: 404,
        });
      }

      const queryToken =
        typeof request.query === "object" &&
        request.query !== null &&
        "token" in request.query
          ? String((request.query as { token?: string }).token ?? "")
          : "";
      const headerSecret =
        (request.headers["x-nvoip-webhook-secret"] as string | undefined) ??
        (request.headers["x-openconduit-token"] as string | undefined);
      const providedSecret = queryToken || headerSecret;

      if (!verifyNvoipCallWebhookSecret(account.externalConfig, providedSecret)) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Invalid webhook secret",
          statusCode: 401,
        });
      }

      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : {};

      const result = await handleNvoipCallWebhook({
        organizationId: request.params.organizationId,
        body,
      });

      if (!result.ok) {
        return reply.status(result.status).send({
          error: result.status === 404 ? "Not Found" : "Error",
          message: result.message,
          statusCode: result.status,
        });
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { organizationId: string; dispatchId: string } }>(
    "/nvoip/:organizationId/dtmf/:dispatchId",
    async (request, reply) => {
      const token =
        (typeof request.query === "object" &&
          request.query !== null &&
          "token" in request.query &&
          String((request.query as { token?: string }).token ?? "")) ||
        "";
      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : {};

      const result = await handleNvoipDtmfWebhook({
        organizationId: request.params.organizationId,
        dispatchId: request.params.dispatchId,
        token,
        body,
      });

      if (!result.ok) {
        return reply.status(result.status).send({
          error: result.status === 404 ? "Not Found" : "Error",
          message: result.message,
          statusCode: result.status,
        });
      }
      return { ok: true };
    },
  );

  app.post("/stripe", webhookPostOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isStripeBillingConfigured()) {
      return reply.status(503).send({
        error: "stripe_not_configured",
        message: "Stripe billing is not configured on this server",
        statusCode: 503,
      });
    }

    const signatureRaw = request.headers["stripe-signature"];
    const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw;
    const rawBody =
      (request as WebhookRequest).rawBody ??
      (typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? ""));

    try {
      const event = constructStripeWebhookEvent(rawBody, signature);
      const processed = await processStripeWebhookEvent(event);
      return { received: true, duplicate: !processed };
    } catch (err) {
      if (err instanceof StripeWebhookError) {
        return reply.status(err.statusCode).send({
          error: "stripe_webhook_error",
          message: err.message,
          statusCode: err.statusCode,
        });
      }
      request.log.error({ err }, "Stripe webhook processing failed");
      return reply.status(500).send({
        error: "internal_error",
        message: "Stripe webhook processing failed",
        statusCode: 500,
      });
    }
  });

  app.post<{ Params: { organizationId: string; toolId: string } }>(
    "/stripe/org/:organizationId/:toolId",
    webhookPostOpts,
    async (request, reply) => {
      const signatureRaw = request.headers["stripe-signature"];
      const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw;
      const rawBody =
        (request as WebhookRequest).rawBody ??
        (typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? ""));

      const tool = await loadOrganizationStripeToolForWebhook({
        organizationId: request.params.organizationId,
        toolId: request.params.toolId,
      });
      if (!tool) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Stripe tool not found",
          statusCode: 404,
        });
      }
      if (!tool.isActive) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Stripe tool is inactive",
          statusCode: 400,
        });
      }

      try {
        const event = constructOrganizationStripeWebhookEvent(rawBody, signature, tool.cfg.webhookSecret);
        const processed = await processOrganizationStripeToolWebhook({
          organizationId: request.params.organizationId,
          toolId: request.params.toolId,
          event,
        });
        return { received: true, duplicate: processed.duplicate, result: processed.result };
      } catch (err) {
        if (err instanceof OrganizationStripeWebhookError) {
          return reply.status(err.statusCode).send({
            error: "organization_stripe_webhook_error",
            message: err.message,
            statusCode: err.statusCode,
          });
        }
        request.log.error({ err }, "Organization Stripe tool webhook processing failed");
        return reply.status(500).send({
          error: "internal_error",
          message: "Organization Stripe tool webhook processing failed",
          statusCode: 500,
        });
      }
    },
  );

  app.post<{ Params: { organizationId: string; toolId: string } }>(
    "/mercadopago/org/:organizationId/:toolId",
    webhookPostOpts,
    async (request, reply) => {
      const body = normalizeJsonBody(request.body);
      if (body === null) {
        return reply.status(400).send({ error: "Invalid JSON body" });
      }

      const query =
        typeof request.query === "object" && request.query !== null
          ? (request.query as Record<string, string | undefined>)
          : {};

      const tool = await loadOrganizationMercadoPagoToolForWebhook({
        organizationId: request.params.organizationId,
        toolId: request.params.toolId,
      });
      if (!tool) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Mercado Pago tool not found",
          statusCode: 404,
        });
      }
      if (!tool.isActive) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Mercado Pago tool is inactive",
          statusCode: 400,
        });
      }

      try {
        assertOrganizationMercadoPagoWebhookSignature(
          request.headers as Record<string, string | string[] | undefined>,
          query,
          tool.cfg.webhookSecret,
        );
        const notification = body as MercadoPagoWebhookNotification;
        const processed = await processOrganizationMercadoPagoToolWebhook({
          organizationId: request.params.organizationId,
          toolId: request.params.toolId,
          notification,
          rawPayload: body,
        });
        return { received: true, duplicate: processed.duplicate, result: processed.result };
      } catch (err) {
        if (err instanceof OrganizationMercadoPagoWebhookError) {
          return reply.status(err.statusCode).send({
            error: "organization_mercadopago_webhook_error",
            message: err.message,
            statusCode: err.statusCode,
          });
        }
        request.log.error({ err }, "Organization Mercado Pago tool webhook processing failed");
        return reply.status(500).send({
          error: "internal_error",
          message: "Organization Mercado Pago tool webhook processing failed",
          statusCode: 500,
        });
      }
    },
  );

  app.post("/mercadopago", webhookPostOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isMercadoPagoWebhookConfigured()) {
      return reply.status(503).send({
        error: "mercadopago_not_configured",
        message: "Mercado Pago webhooks are not configured on this server",
        statusCode: 503,
      });
    }

    const body = normalizeJsonBody(request.body);
    if (body === null) {
      return reply.status(400).send({ error: "Invalid JSON body" });
    }

    const query =
      typeof request.query === "object" && request.query !== null
        ? (request.query as Record<string, string | undefined>)
        : {};

    try {
      assertMercadoPagoWebhookSignature(
        request.headers as Record<string, string | string[] | undefined>,
        query,
      );
      const notification = body as MercadoPagoWebhookNotification;
      const processed = await processMercadoPagoWebhookNotification(notification, body);
      return { received: true, duplicate: !processed };
    } catch (err) {
      if (err instanceof MercadoPagoWebhookError) {
        return reply.status(err.statusCode).send({
          error: "mercadopago_webhook_error",
          message: err.message,
          statusCode: err.statusCode,
        });
      }
      request.log.error({ err }, "Mercado Pago webhook processing failed");
      return reply.status(500).send({
        error: "internal_error",
        message: "Mercado Pago webhook processing failed",
        statusCode: 500,
      });
    }
  });
}
