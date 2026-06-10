import { FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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
  nvoipDeleteScheduledTorpedo,
  nvoipScheduleVoiceTorpedo,
  nvoipUpdateDid,
  nvoipCreateSipUser,
  nvoipUpdateSipUser,
  nvoipDeleteSipUser,
  nvoipSameNumbersip,
} from "../lib/nvoipClient.js";
import { maybeAlertNvoipLowBalance } from "../lib/nvoipBalanceAlert.js";
import { type NvoipIncomingQueueConfig } from "../lib/nvoipIncomingQueue.js";
import { mergeNvoipExternalConfig, readNvoipExternalConfig } from "../lib/nvoipExternalConfig.js";
import {
  ensureSingleDefaultTrunk,
  listNvoipTrunks,
  trunkToClient,
  validateNvoipOutboundCallerForOrg,
} from "../lib/nvoipTrunks.js";
import { runNvoipHomologation } from "../lib/nvoipHomologation.js";
import { writeNvoipIntegrationLog } from "../lib/nvoipIntegrationLog.js";
import { sendNvoipTorpedoTest, nvoipVoiceSafeText } from "../lib/nvoipTorpedo.js";
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
import { buildNvoipPabxTrunkInfo, maskNvoipTrunkPasswordForClient } from "../lib/nvoipPabxTrunkInfo.js";
import { syncNvoipInboundHistoryForAccount } from "../lib/nvoipInboundSync.js";
import type { NvoipPabxMode } from "../lib/nvoipPabxConfig.js";

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
  incomingQueue: z
    .object({
      mode: z.enum(["all", "team"]),
      teamId: z.string().uuid().nullable().optional(),
    })
    .optional(),
  lowBalanceAlertBrl: z.number().positive().max(1_000_000).nullable().optional(),
  balanceAlertEmails: z.string().max(2000).optional(),
  recordingRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
});

const extensionSchema = z.object({
  caller: z.string().max(32).optional(),
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

    const callerCheck = await validateNvoipOutboundCallerForOrg(
      organizationId,
      parsed.data.defaultCaller.trim(),
      parsed.data.numbersip.trim(),
      existing?.id,
    );
    if (!callerCheck.ok) {
      return reply.status(400).send({
        error: "Bad Request",
        message: callerCheck.message,
        statusCode: 400,
      });
    }

    let externalConfigPatch: Prisma.InputJsonValue | undefined;
    if (
      parsed.data.incomingQueue !== undefined ||
      parsed.data.lowBalanceAlertBrl !== undefined ||
      parsed.data.balanceAlertEmails !== undefined ||
      parsed.data.recordingRetentionDays !== undefined
    ) {
      const base = existing?.externalConfig ?? {};
      const queue: NvoipIncomingQueueConfig | undefined =
        parsed.data.incomingQueue !== undefined
          ? {
              mode: parsed.data.incomingQueue.mode,
              teamId: parsed.data.incomingQueue.teamId ?? null,
            }
          : undefined;
      const emails =
        parsed.data.balanceAlertEmails !== undefined
          ? parsed.data.balanceAlertEmails
              .split(/[,;]+/)
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e.includes("@"))
          : undefined;
      externalConfigPatch = mergeNvoipExternalConfig(base, {
        incomingQueue: queue,
        lowBalanceAlertBrl:
          parsed.data.lowBalanceAlertBrl !== undefined ? parsed.data.lowBalanceAlertBrl : undefined,
        balanceAlertEmails: emails,
        recordingRetentionDays:
          parsed.data.recordingRetentionDays !== undefined
            ? parsed.data.recordingRetentionDays
            : undefined,
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
          ...(externalConfigPatch !== undefined ? { externalConfig: externalConfigPatch } : {}),
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
          ...(externalConfigPatch !== undefined ? { externalConfig: externalConfigPatch } : {}),
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

    const napikey = decryptNvoipSecret(row.napikeyEnc);
    const test = await testNvoipConnection({
      numbersip: row.numbersip,
      userToken,
      napikey,
    });
    if (test.ok) {
      try {
        const tokens = test.tokens;
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

    let caller = parsed.data.caller?.trim() ?? "";
    if (!caller && numbersip) {
      const sip = await prisma.nvoipSipUser.findFirst({
        where: { nvoipAccountId: account.id, numbersip, blocked: false },
        select: { caller: true },
      });
      caller = sip?.caller?.trim() ?? "";
    }
    if (!caller) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "caller_required",
        statusCode: 400,
      });
    }

    await prisma.nvoipAgentExtension.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: {
        organizationId,
        nvoipAccountId: account.id,
        userId: user.id,
        caller,
        ...(numbersip !== undefined ? { nvoipNumbersip: numbersip } : {}),
      },
      update: {
        caller,
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
      const alert = await maybeAlertNvoipLowBalance(account, balance);
      await prisma.nvoipAccount.update({
        where: { id: account.id },
        data: { lastBalance: balance, lastStatusAt: new Date() },
      });
      return { balance, balanceLow: alert.low, balanceAlertThresholdBrl: alert.thresholdBrl };
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

  app.delete<{ Params: { schedkey: string } }>("/torpedos/scheduled/:schedkey", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    const schedkey = request.params.schedkey.trim();
    if (!schedkey) {
      return reply.status(400).send({ error: "Bad Request", message: "invalid_schedkey", statusCode: 400 });
    }

    try {
      await nvoipDeleteScheduledTorpedo(account, schedkey);
      await prisma.nvoipScheduledTorpedo.deleteMany({ where: { organizationId, schedkey } });
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "info",
        eventType: "torpedo_sched_cancelled",
        message: `Cancelled scheduled torpedo ${schedkey}`,
      });
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "cancel_sched_failed",
        statusCode: 400,
      });
    }
  });

  app.post("/torpedos/schedule", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        phone: z.string().min(8),
        message: z.string().min(1).max(900),
        scheduledAt: z.string().datetime(),
        caller: z.string().max(32).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    const caller = (body.data.caller ?? account.defaultCaller).trim();
    if (!caller) {
      return reply.status(400).send({ error: "Bad Request", message: "nvoip_no_caller", statusCode: 400 });
    }

    const scheduledAt = new Date(body.data.scheduledAt);
    if (scheduledAt.getTime() <= Date.now()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "scheduled_at_must_be_future",
        statusCode: 400,
      });
    }

    const text = nvoipVoiceSafeText(body.data.message);
    if (!text) {
      return reply.status(400).send({ error: "Bad Request", message: "empty_message", statusCode: 400 });
    }

    try {
      const { schedkey, raw } = await nvoipScheduleVoiceTorpedo(account, {
        caller,
        called: body.data.phone.trim(),
        audios: [{ text }],
        scheduledAt,
      });
      await prisma.nvoipScheduledTorpedo.upsert({
        where: { schedkey },
        create: {
          organizationId,
          nvoipAccountId: account.id,
          schedkey,
          status: "SCHEDULED",
          recipientCount: 1,
          scheduledAt,
          payload: raw as object,
        },
        update: {
          status: "SCHEDULED",
          scheduledAt,
          payload: raw as object,
        },
      });
      return { ok: true, schedkey };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "schedule_torpedo_failed",
        statusCode: 400,
      });
    }
  });

  app.put("/dids", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        number: z.string().min(4).max(32),
        destination: z.string().min(1).max(256),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    try {
      const raw = await nvoipUpdateDid(account, body.data);
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "info",
        eventType: "did_updated",
        message: `DID ${body.data.number} → ${body.data.destination}`,
      });
      return { ok: true, raw };
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "update_did_failed",
        statusCode: 400,
      });
    }
  });

  app.post("/users", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        name: z.string().min(1).max(128),
        caller: z.string().min(1).max(32),
        sipPassword: z.string().min(4).max(64).optional(),
        webphone: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    try {
      const raw = await nvoipCreateSipUser(account, body.data);
      await syncNvoipSipUsers(account);
      const sipUsers = await listCachedNvoipSipUsers(account.id);
      return {
        ok: true,
        raw,
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
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "create_user_failed",
        statusCode: 400,
      });
    }
  });

  app.put<{ Params: { numbersip: string } }>("/users/:numbersip", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        name: z.string().min(1).max(128).optional(),
        blocked: z.boolean().optional(),
        webphone: z.boolean().optional(),
        sipPassword: z.string().min(4).max(64).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }
    if (
      body.data.name === undefined &&
      body.data.blocked === undefined &&
      body.data.webphone === undefined &&
      body.data.sipPassword === undefined
    ) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "no_fields_to_update",
        statusCode: 400,
      });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    const targetNumbersip = decodeURIComponent(request.params.numbersip).trim();
    if (!targetNumbersip) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "numbersip_required",
        statusCode: 400,
      });
    }

    if (nvoipSameNumbersip(targetNumbersip, account.numbersip)) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "nvoip_primary_user_not_editable",
        statusCode: 400,
      });
    }

    const cached = await prisma.nvoipSipUser.findFirst({
      where: { nvoipAccountId: account.id, numbersip: targetNumbersip },
      select: { caller: true, name: true },
    });
    if (!cached) {
      return reply.status(404).send({
        error: "Not Found",
        message: "sip_user_not_found",
        statusCode: 404,
      });
    }

    try {
      const raw = await nvoipUpdateSipUser(account, {
        numbersip: targetNumbersip,
        caller: cached.caller ?? undefined,
        name: body.data.name ?? cached.name ?? undefined,
        blocked: body.data.blocked,
        webphone: body.data.webphone,
        sipPassword: body.data.sipPassword,
      });
      await syncNvoipSipUsers(account);
      const sipUsers = await listCachedNvoipSipUsers(account.id);
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "info",
        eventType: "sip_user_updated",
        message: `PUT /update/users numbersip=${request.params.numbersip}`,
        payload: body.data as object,
      });
      return {
        ok: true,
        raw,
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
        eventType: "sip_user_update_failed",
        message: err instanceof Error ? err.message : "update_user_failed",
        payload: { numbersip: targetNumbersip, ...body.data },
      });
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "update_user_failed",
        statusCode: 400,
      });
    }
  });

  app.delete<{ Params: { numbersip: string } }>("/users/:numbersip", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "account_not_connected",
        statusCode: 400,
      });
    }

    const numbersip = decodeURIComponent(request.params.numbersip).trim();
    if (!numbersip) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "numbersip_required",
        statusCode: 400,
      });
    }

    if (nvoipSameNumbersip(numbersip, account.numbersip)) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "nvoip_primary_user_not_editable",
        statusCode: 400,
      });
    }

    try {
      const raw = await nvoipDeleteSipUser(account, numbersip);
      await syncNvoipSipUsers(account);
      await prisma.nvoipAgentExtension.updateMany({
        where: { organizationId, nvoipNumbersip: numbersip },
        data: { nvoipNumbersip: null },
      });
      const sipUsers = await listCachedNvoipSipUsers(account.id);
      await writeNvoipIntegrationLog({
        organizationId,
        nvoipAccountId: account.id,
        level: "info",
        eventType: "sip_user_deleted",
        message: `DELETE /delete/users numbersip=${numbersip}`,
      });
      return {
        ok: true,
        raw,
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
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "delete_user_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/teams", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const teams = await prisma.team.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { data: teams };
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

  app.get("/trunks", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;
    const data = await listNvoipTrunks(organizationId);
    return { data };
  });

  app.post("/trunks", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        name: z.string().min(1).max(128),
        defaultCaller: z.string().min(1).max(32),
        isDefault: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(400).send({ error: "Bad Request", message: "account_not_found", statusCode: 400 });
    }

    const callerCheck = await validateNvoipOutboundCallerForOrg(
      organizationId,
      body.data.defaultCaller.trim(),
    );
    if (!callerCheck.ok) {
      return reply.status(400).send({
        error: "Bad Request",
        message: callerCheck.message,
        statusCode: 400,
      });
    }

    const row = await prisma.nvoipTrunk.create({
      data: {
        organizationId,
        nvoipAccountId: account.id,
        name: body.data.name.trim(),
        defaultCaller: body.data.defaultCaller.trim(),
        isDefault: body.data.isDefault ?? false,
      },
    });
    if (body.data.isDefault) {
      await ensureSingleDefaultTrunk(organizationId, account.id, row.id);
    }
    return { trunk: trunkToClient(row) };
  });

  app.put<{ Params: { id: string } }>("/trunks/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const body = z
      .object({
        name: z.string().min(1).max(128).optional(),
        defaultCaller: z.string().min(1).max(32).optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Bad Request", message: body.error.message, statusCode: 400 });
    }

    const existing = await prisma.nvoipTrunk.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "trunk_not_found", statusCode: 404 });
    }

    if (body.data.defaultCaller !== undefined) {
      const callerCheck = await validateNvoipOutboundCallerForOrg(
        organizationId,
        body.data.defaultCaller.trim(),
      );
      if (!callerCheck.ok) {
        return reply.status(400).send({
          error: "Bad Request",
          message: callerCheck.message,
          statusCode: 400,
        });
      }
    }

    const row = await prisma.nvoipTrunk.update({
      where: { id: existing.id },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
        ...(body.data.defaultCaller !== undefined
          ? { defaultCaller: body.data.defaultCaller.trim() }
          : {}),
        ...(body.data.isDefault !== undefined ? { isDefault: body.data.isDefault } : {}),
      },
    });
    if (body.data.isDefault) {
      await ensureSingleDefaultTrunk(organizationId, existing.nvoipAccountId, row.id);
    }
    return { trunk: trunkToClient(row) };
  });

  app.delete<{ Params: { id: string } }>("/trunks/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const deleted = await prisma.nvoipTrunk.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (deleted.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "trunk_not_found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.get("/pabx/trunk", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({
        error: "Not Found",
        message: "account_not_found",
        statusCode: 404,
      });
    }

    const info = maskNvoipTrunkPasswordForClient(await buildNvoipPabxTrunkInfo(account));
    return { trunk: info, connected: account.status === "CONNECTED" };
  });

  app.get("/pabx/trunk/credentials", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;
    await requireAdmin(request, reply);
    if (reply.sent) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({
        error: "Not Found",
        message: "account_not_found",
        statusCode: 404,
      });
    }

    const info = await buildNvoipPabxTrunkInfo(account);
    return {
      sipUser: info.sipUser,
      sipPassword: info.sipPassword,
      sipServer: info.sipServer,
      sipPort: info.sipPort,
      sipPasswordConfigured: info.sipPasswordConfigured,
    };
  });

  app.put("/pabx/config", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;
    await requireAdmin(request, reply);
    if (reply.sent) return;

    const schema = z.object({
      mode: z.enum(["platform_webphone", "external_pabx_trunk"]).optional(),
      trunkSipPassword: z.string().min(4).max(64).optional(),
      clearTrunkSipPassword: z.boolean().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account) {
      return reply.status(404).send({ error: "Not Found", message: "account_not_found", statusCode: 404 });
    }

    const merged = mergeNvoipExternalConfig(account.externalConfig, {
      ...(parsed.data.mode ? { pabxMode: parsed.data.mode as NvoipPabxMode } : {}),
      ...(parsed.data.clearTrunkSipPassword ? { clearTrunkSipPassword: true } : {}),
      ...(parsed.data.trunkSipPassword?.trim()
        ? { trunkSipPasswordEnc: encryptNvoipSecret(parsed.data.trunkSipPassword.trim()) }
        : {}),
    });

    await prisma.nvoipAccount.update({
      where: { id: account.id },
      data: { externalConfig: merged },
    });

    await recordAuditLog({
      actorUserId: request.user.id,
      organizationId,
      action: "nvoip.pabx.config_update",
      resourceType: "nvoip_account",
      resourceId: account.id,
      ip: clientIp(request),
      metadata: { mode: parsed.data.mode ?? null },
    });

    const info = maskNvoipTrunkPasswordForClient(
      await buildNvoipPabxTrunkInfo({
        ...account,
        externalConfig: merged as Prisma.JsonValue,
      }),
    );
    return { ok: true, trunk: info };
  });

  app.post("/pabx/sync-inbound", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    if (!account || account.status !== "CONNECTED") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "nvoip_not_connected",
        statusCode: 400,
      });
    }

    const stats = await syncNvoipInboundHistoryForAccount(account);
    return { ok: true, ...stats };
  });

  app.post("/homologation/run", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;
    if (!(await requireNvoipVoice(organizationId, reply))) return;

    try {
      return await runNvoipHomologation(organizationId);
    } catch (err) {
      return reply.status(400).send({
        error: "Bad Request",
        message: err instanceof Error ? err.message : "homologation_failed",
        statusCode: 400,
      });
    }
  });

  app.get("/homologation/last", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
    const ext = readNvoipExternalConfig(account?.externalConfig ?? null);
    return { last: ext.homologationLast };
  });
}
