import { FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { recordAuditLog, clientIp } from "../lib/audit.js";
import { isAnyNvoipFeatureEnabled, isOrganizationFeatureEnabled } from "../lib/featureFlags.js";
import {
  accountToClientRow,
  decryptNvoipSecret,
  encryptNvoipSecret,
  MASKED_NVOIP_SECRET,
} from "../lib/nvoipConfig.js";
import {
  testNvoipConnection,
  nvoipPasswordGrant,
  nvoipGetBalance,
  nvoipListDids,
  nvoipListScheduledTorpedos,
  nvoipListUra,
} from "../lib/nvoipClient.js";
import { writeNvoipIntegrationLog } from "../lib/nvoipIntegrationLog.js";
import { sendNvoipTorpedoTest } from "../lib/nvoipTorpedo.js";
import { listCachedNvoipSipUsers, syncNvoipSipUsers } from "../lib/nvoipDirectorySync.js";
import { sendNvoipSmsToPhone } from "../lib/nvoipSms.js";
import { resolveOrgOtpProvider } from "../lib/otp/resolveOtpProvider.js";
import { parseOtpChannel } from "../lib/otp/nvoipOtpProvider.js";
import {
  getNvoipWhatsappAvailability,
  listNvoipWhatsappTemplates,
  sendNvoipWhatsappTemplate,
} from "../lib/nvoipWhatsapp.js";
import { buildNvoipOrgInsights } from "../lib/nvoipInsights.js";

const upsertSchema = z.object({
  numbersip: z.string().min(1).max(64),
  userToken: z.string().min(4).max(512).optional(),
  napikey: z.string().max(512).optional(),
  defaultCaller: z.string().min(1).max(32),
  inboxId: z.string().uuid().nullable().optional(),
  otpProvider: z.enum(["DISABLED", "NVOIP"]).optional(),
  otpDefaultChannel: z.enum(["sms", "voice", "email"]).optional(),
  waInstance: z.string().max(128).nullable().optional(),
  waDefaultLanguage: z.string().max(16).optional(),
});

const extensionSchema = z.object({
  caller: z.string().min(1).max(32),
  nvoipNumbersip: z.string().max(64).nullable().optional(),
});

export async function nvoipIntegrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireAdmin);
  app.addHook("preHandler", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    const enabled = await isAnyNvoipFeatureEnabled(organizationId);
    if (!enabled) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "nvoip_disabled",
        statusCode: 403,
      });
    }
  });

  async function requireNvoipVoice(organizationId: string, reply: FastifyReply) {
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

  app.get("/account", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const row = await prisma.nvoipAccount.findUnique({
      where: { organizationId },
      include: { inbox: { select: { name: true } } },
    });
    if (!row) return { account: null };
    return { account: accountToClientRow(row) };
  });

  app.put("/account", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    const userToken =
      parsed.data.userToken?.trim() && parsed.data.userToken !== MASKED_NVOIP_SECRET
        ? parsed.data.userToken.trim()
        : null;
    const napikey =
      parsed.data.napikey?.trim() && parsed.data.napikey !== MASKED_NVOIP_SECRET
        ? parsed.data.napikey.trim()
        : null;

    if (!existing && !userToken) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "user_token_required",
        statusCode: 400,
      });
    }

    let row;
    if (existing) {
      row = await prisma.nvoipAccount.update({
        where: { id: existing.id },
        data: {
          numbersip: parsed.data.numbersip.trim(),
          defaultCaller: parsed.data.defaultCaller.trim(),
          inboxId: parsed.data.inboxId ?? null,
          ...(parsed.data.otpProvider !== undefined ? { otpProvider: parsed.data.otpProvider } : {}),
          ...(parsed.data.otpDefaultChannel !== undefined
            ? { otpDefaultChannel: parsed.data.otpDefaultChannel }
            : {}),
          ...(parsed.data.waInstance !== undefined
            ? { waInstance: parsed.data.waInstance?.trim() || null }
            : {}),
          ...(parsed.data.waDefaultLanguage !== undefined
            ? { waDefaultLanguage: parsed.data.waDefaultLanguage.trim() || "pt_BR" }
            : {}),
          ...(userToken ? { userTokenEnc: encryptNvoipSecret(userToken) } : {}),
          ...(napikey !== undefined ? { napikeyEnc: napikey ? encryptNvoipSecret(napikey) : null } : {}),
        },
        include: { inbox: { select: { name: true } } },
      });
    } else {
      row = await prisma.nvoipAccount.create({
        data: {
          organizationId,
          numbersip: parsed.data.numbersip.trim(),
          userTokenEnc: encryptNvoipSecret(userToken!),
          napikeyEnc: napikey ? encryptNvoipSecret(napikey) : null,
          defaultCaller: parsed.data.defaultCaller.trim(),
          inboxId: parsed.data.inboxId ?? null,
          otpProvider: parsed.data.otpProvider ?? "DISABLED",
          otpDefaultChannel: parsed.data.otpDefaultChannel ?? "sms",
          waInstance: parsed.data.waInstance?.trim() || null,
          waDefaultLanguage: parsed.data.waDefaultLanguage?.trim() || "pt_BR",
          status: "DISCONNECTED",
        },
        include: { inbox: { select: { name: true } } },
      });
    }

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: existing ? "nvoip.account.update" : "nvoip.account.create",
      resourceType: "nvoip_account",
      resourceId: row.id,
      ip: clientIp(request),
    });

    return { account: accountToClientRow(row) };
  });

  app.post("/account/test", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const row = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }

    const userToken = decryptNvoipSecret(row.userTokenEnc);
    if (!userToken) {
      return reply.status(400).send({ ok: false, message: "missing_user_token" });
    }

    const test = await testNvoipConnection({ numbersip: row.numbersip, userToken });
    if (test.ok) {
      try {
        const tokens = await nvoipPasswordGrant(row.numbersip, userToken);
        const expiresIn = Number(tokens.expires_in) || 86_400;
        await prisma.nvoipAccount.update({
          where: { id: row.id },
          data: {
            status: "CONNECTED",
            lastStatusAt: new Date(),
            lastError: null,
            lastBalance: test.balance,
            accessTokenEnc: encryptNvoipSecret(tokens.access_token),
            refreshTokenEnc: tokens.refresh_token
              ? encryptNvoipSecret(tokens.refresh_token)
              : null,
            tokenExpiresAt: new Date(Date.now() + Math.max(60, expiresIn - 120) * 1000),
          },
        });
        await writeNvoipIntegrationLog({
          organizationId,
          nvoipAccountId: row.id,
          level: "info",
          eventType: "connection_test",
          message: `OK balance=${test.balance}`,
        });
      } catch (err) {
        await prisma.nvoipAccount.update({
          where: { id: row.id },
          data: {
            status: "ERROR",
            lastStatusAt: new Date(),
            lastError: err instanceof Error ? err.message : "token_persist_failed",
          },
        });
        return reply.status(400).send({ ok: false, message: "token_persist_failed" });
      }
      return { ok: true, balance: test.balance };
    }

    await prisma.nvoipAccount.update({
      where: { id: row.id },
      data: {
        status: "ERROR",
        lastStatusAt: new Date(),
        lastError: test.message,
      },
    });
    await writeNvoipIntegrationLog({
      organizationId,
      nvoipAccountId: row.id,
      level: "error",
      eventType: "connection_test",
      message: test.message,
    });
    return reply.status(400).send({ ok: false, message: test.message });
  });

  app.get("/extensions", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) return { data: [] };

    const users = await prisma.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
    const extensions = await prisma.nvoipAgentExtension.findMany({
      where: { organizationId },
    });
    const byUser = new Map(extensions.map((e) => [e.userId, e]));
    const sipUsers = await listCachedNvoipSipUsers(account.id);
    const directorySyncedAt =
      sipUsers.length > 0
        ? sipUsers.reduce(
            (latest, row) => (row.syncedAt > latest ? row.syncedAt : latest),
            sipUsers[0]!.syncedAt,
          )
        : null;

    return {
      data: users.map((u) => {
        const ext = byUser.get(u.id);
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          caller: ext?.caller ?? null,
          nvoipNumbersip: ext?.nvoipNumbersip ?? null,
        };
      }),
      sipUsers: sipUsers.map((s) => ({
        numbersip: s.numbersip,
        name: s.name,
        caller: s.caller,
        blocked: s.blocked,
        webphone: s.webphone,
        syncedAt: s.syncedAt.toISOString(),
      })),
      directorySyncedAt: directorySyncedAt?.toISOString() ?? null,
    };
  });

  app.put<{ Params: { userId: string } }>("/extensions/:userId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }

    const parsed = extensionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const user = await prisma.user.findFirst({
      where: { id: request.params.userId, organizationId },
      select: { id: true },
    });
    if (!user) {
      return reply.status(404).send({ error: "Not Found", message: "user_not_found", statusCode: 404 });
    }

    const numbersip =
      parsed.data.nvoipNumbersip === undefined
        ? undefined
        : parsed.data.nvoipNumbersip?.trim() || null;

    await prisma.nvoipAgentExtension.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: {
        organizationId,
        nvoipAccountId: account.id,
        userId: user.id,
        caller: parsed.data.caller.trim(),
        ...(numbersip !== undefined ? { nvoipNumbersip: numbersip } : {}),
      },
      update: {
        caller: parsed.data.caller.trim(),
        ...(numbersip !== undefined ? { nvoipNumbersip: numbersip } : {}),
      },
    });

    return { ok: true };
  });

  app.post("/users/sync", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }
    if (account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    try {
      const result = await syncNvoipSipUsers(account);
      const sipUsers = await listCachedNvoipSipUsers(account.id);
      return {
        ok: true,
        synced: result.synced,
        sipUsers: sipUsers.map((s) => ({
          numbersip: s.numbersip,
          name: s.name,
          caller: s.caller,
          blocked: s.blocked,
          webphone: s.webphone,
          syncedAt: s.syncedAt.toISOString(),
        })),
      };
    } catch (err) {
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "error",
        eventType: "directory_sync",
        message: err instanceof Error ? err.message : "sync_failed",
      });
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "sync_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/users", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) return { data: [], directorySyncedAt: null };

    const sipUsers = await listCachedNvoipSipUsers(account.id);
    const directorySyncedAt =
      sipUsers.length > 0
        ? sipUsers.reduce(
            (latest, row) => (row.syncedAt > latest ? row.syncedAt : latest),
            sipUsers[0]!.syncedAt,
          )
        : null;

    return {
      data: sipUsers.map((s) => ({
        numbersip: s.numbersip,
        name: s.name,
        caller: s.caller,
        blocked: s.blocked,
        webphone: s.webphone,
        syncedAt: s.syncedAt.toISOString(),
      })),
      directorySyncedAt: directorySyncedAt?.toISOString() ?? null,
    };
  });

  app.get("/dids", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }
    if (account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    try {
      const dids = await nvoipListDids(account);
      return { data: dids };
    } catch (err) {
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "warn",
        eventType: "list_dids_failed",
        message: err instanceof Error ? err.message : "list_dids_failed",
      });
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "list_dids_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/balance", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }
    if (account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    try {
      const { balance } = await nvoipGetBalance(account);
      await prisma.nvoipAccount.update({
        where: { id: account.id },
        data: { lastBalance: balance },
      });
      return { balance };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "balance_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/logs", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const logs = await prisma.nvoipIntegrationLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { data: logs };
  });

  app.get("/inboxes", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const inboxes = await prisma.inbox.findMany({
      where: { organizationId },
      select: { id: true, name: true, isDefault: true, channelType: true },
      orderBy: { name: "asc" },
    });
    return inboxes;
  });

  app.get("/torpedos/scheduled", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) return { data: [], local: [] };

    let remote: Record<string, unknown>[] = [];
    try {
      remote = await nvoipListScheduledTorpedos(account);
    } catch (err) {
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "warn",
        eventType: "torpedo_list_failed",
        message: err instanceof Error ? err.message : "list_failed",
      });
    }

    const local = await prisma.nvoipScheduledTorpedo.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return { data: remote, local };
  });

  app.post("/torpedo/test", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        phone: z.string().min(8),
        message: z.string().min(1).max(900),
        caller: z.string().max(32).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "nvoip_not_configured",
        statusCode: 400,
      });
    }

    const result = await sendNvoipTorpedoTest({
      organizationId,
      account,
      phone: body.data.phone,
      message: body.data.message,
      caller: body.data.caller,
    });
    if (!result.ok) {
      return reply.status(400).send({
        error: "Bad Request",
        message: result.message,
        statusCode: 400,
      });
    }
    return { ok: true };
  });

  app.post("/sms/test", async (request, reply) => {
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
        phone: z.string().min(8),
        message: z.string().min(1).max(160),
        flashSms: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    try {
      await sendNvoipSmsToPhone({
        organizationId,
        phone: body.data.phone,
        message: body.data.message,
        flashSms: body.data.flashSms,
        actorUserId: request.user.id,
      });
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "sms_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/whatsapp/status", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    return getNvoipWhatsappAvailability(organizationId);
  });

  app.get("/whatsapp/templates", async (request, reply) => {
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

  app.post("/whatsapp/templates/send", async (request, reply) => {
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

    const body = z
      .object({
        phone: z.string().min(8),
        idTemplate: z.string().min(1).max(128),
        functions: z.array(z.string().max(256)).max(20).optional(),
        language: z.string().max(16).optional(),
        templateName: z.string().max(200).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    try {
      const raw = await sendNvoipWhatsappTemplate({
        organizationId,
        phone: body.data.phone,
        idTemplate: body.data.idTemplate,
        functions: body.data.functions,
        language: body.data.language,
        templateName: body.data.templateName,
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
  });

  app.post("/otp/test", async (request, reply) => {
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

    const body = z
      .object({
        destination: z.string().min(8),
        channel: z.enum(["sms", "voice", "email"]).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    const channel = parseOtpChannel(body.data.channel ?? account?.otpDefaultChannel);

    try {
      const result = await provider.send({
        organizationId,
        destination: body.data.destination,
        channel,
        purpose: "admin_test",
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
  });

  app.get("/ura", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }
    if (account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    try {
      const summary = await nvoipListUra(account);
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "info",
        eventType: "ura_snapshot",
        message: `URA list: ${summary.menus} menus, ${summary.queues} queues`,
      });
      return { summary };
    } catch (err) {
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "warn",
        eventType: "ura_list_failed",
        message: err instanceof Error ? err.message : "ura_failed",
      });
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "ura_list_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/insights", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const q = z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).safeParse(request.query);
    const periodDays = q.success && q.data.days ? q.data.days : 30;

    try {
      return await buildNvoipOrgInsights(organizationId, periodDays);
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "insights_failed",
        statusCode: 400,
      });
    }
  });
}
