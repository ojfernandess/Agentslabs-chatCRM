import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import { sendNvoipSmsToPhone } from "../lib/nvoipSms.js";
import { resolveOrgOtpProvider } from "../lib/otp/resolveOtpProvider.js";
import { parseOtpChannel } from "../lib/otp/nvoipOtpProvider.js";
import { appendTimelineEvent } from "../lib/timeline.js";
import { getNvoipWhatsappAvailability, sendNvoipWhatsappTemplate } from "../lib/nvoipWhatsapp.js";

export async function nvoipContactMessagingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post<{ Params: { contactId: string } }>(
    "/contacts/:contactId/nvoip/sms",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const smsEnabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_sms");
      if (!smsEnabled) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "nvoip_sms_disabled",
          statusCode: 403,
        });
      }

      const body = z
        .object({
          message: z.string().min(1).max(160),
          flashSms: z.boolean().optional(),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
      }

      const contact = await prisma.contact.findFirst({
        where: { id: request.params.contactId, organizationId },
        select: { id: true, phone: true },
      });
      if (!contact?.phone?.trim()) {
        return reply.status(404).send({ error: "Not Found", message: "contact_not_found", statusCode: 404 });
      }

      try {
        await sendNvoipSmsToPhone({
          organizationId,
          phone: contact.phone,
          message: body.data.message,
          flashSms: body.data.flashSms,
          actorUserId: request.user.id,
          contactId: contact.id,
        });
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({
          error: "Bad Request",
          message: err instanceof Error ? err.message : "sms_failed",
          statusCode: 400,
        });
      }
    },
  );

  app.post<{ Params: { contactId: string } }>(
    "/contacts/:contactId/nvoip/otp/send",
    async (request, reply) => {
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

      const provider = await resolveOrgOtpProvider(organizationId);
      if (!provider) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "otp_provider_not_configured",
          statusCode: 400,
        });
      }

      const parsed = z
        .object({ channel: z.enum(["sms", "voice", "email"]).optional() })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const contact = await prisma.contact.findFirst({
        where: { id: request.params.contactId, organizationId },
        select: { id: true, phone: true, email: true },
      });
      if (!contact) {
        return reply.status(404).send({ error: "Not Found", message: "contact_not_found", statusCode: 404 });
      }

      const channel = parseOtpChannel(parsed.data.channel);
      const destination =
        channel === "email" ? (contact.email?.trim() ?? "") : (contact.phone?.trim() ?? "");
      if (!destination) {
        return reply.status(400).send({
          error: "Bad Request",
          message: channel === "email" ? "contact_email_required" : "contact_phone_required",
          statusCode: 400,
        });
      }

      try {
        const result = await provider.send({
          organizationId,
          destination,
          channel,
          purpose: "contact_phone_verify",
          contactId: contact.id,
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
    },
  );

  app.post<{ Params: { contactId: string } }>(
    "/contacts/:contactId/nvoip/otp/verify",
    async (request, reply) => {
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

      const provider = await resolveOrgOtpProvider(organizationId);
      if (!provider) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "otp_provider_not_configured",
          statusCode: 400,
        });
      }

      const parsed = z
        .object({
          challengeId: z.string().uuid(),
          code: z.string().min(4).max(12),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const contact = await prisma.contact.findFirst({
        where: { id: request.params.contactId, organizationId },
        select: { id: true },
      });
      if (!contact) {
        return reply.status(404).send({ error: "Not Found", message: "contact_not_found", statusCode: 404 });
      }

      const challenge = await prisma.nvoipOtpChallenge.findFirst({
        where: {
          id: parsed.data.challengeId,
          organizationId,
          contactId: contact.id,
        },
      });
      if (!challenge) {
        return reply.status(404).send({ error: "Not Found", message: "otp_challenge_not_found", statusCode: 404 });
      }

      try {
        const result = await provider.verify({
          organizationId,
          challengeId: parsed.data.challengeId,
          code: parsed.data.code,
        });
        if (result.ok) {
          await appendTimelineEvent({
            organizationId,
            subjectType: "CONTACT",
            subjectId: contact.id,
            eventType: "nvoip_otp_verified",
            channel: "NVOIP_OTP",
            actorUserId: request.user.id,
            payload: { title: "Telefone verificado (OTP Nvoip)" },
          });
        }
        return result;
      } catch (err) {
        return reply.status(400).send({
          error: "Bad Request",
          message: err instanceof Error ? err.message : "otp_verify_failed",
          statusCode: 400,
        });
      }
    },
  );

  app.post<{ Params: { contactId: string } }>(
    "/contacts/:contactId/nvoip/whatsapp/template",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const availability = await getNvoipWhatsappAvailability(organizationId);
      if (!availability.available) {
        return reply.status(403).send({
          error: "Forbidden",
          message: availability.blockedReason ?? "nvoip_whatsapp_unavailable",
          statusCode: 403,
        });
      }

      const parsed = z
        .object({
          idTemplate: z.string().min(1).max(128),
          functions: z.array(z.string().max(256)).max(20).optional(),
          language: z.string().max(16).optional(),
          templateName: z.string().max(200).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
      }

      const contact = await prisma.contact.findFirst({
        where: { id: request.params.contactId, organizationId },
        select: { id: true, phone: true },
      });
      if (!contact?.phone?.trim()) {
        return reply.status(404).send({ error: "Not Found", message: "contact_not_found", statusCode: 404 });
      }

      try {
        const raw = await sendNvoipWhatsappTemplate({
          organizationId,
          phone: contact.phone,
          idTemplate: parsed.data.idTemplate,
          functions: parsed.data.functions,
          language: parsed.data.language,
          templateName: parsed.data.templateName,
          contactId: contact.id,
          actorUserId: request.user.id,
        });
        return { ok: true, raw };
      } catch (err) {
        return reply.status(400).send({
          error: "Bad Request",
          message: err instanceof Error ? err.message : "wa_template_failed",
          statusCode: 400,
        });
      }
    },
  );
}
