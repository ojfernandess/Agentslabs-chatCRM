import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { getWebAppPublicOrigin, googleCalendarOAuthCallbackUrl } from "../config.js";
import {
  buildGoogleOAuthAuthorizeUrl,
  createGoogleOAuthState,
  exchangeGoogleOAuthCode,
  fetchGoogleCalendarList,
  fetchGoogleUserInfo,
  refreshGoogleAccessToken,
  verifyGoogleOAuthState,
} from "../lib/googleCalendarOAuth.js";
import {
  createTeamInviteToken,
  googleCalendarTeamInvitePublicUrl,
  googleCalendarTeamInviteStartUrl,
  readTeamInvites,
  readTeamMembers,
  rebuildConnectedCalendars,
  redactTeamMembersForClient,
  verifyTeamInviteToken,
  type GoogleCalendarTeamMember,
} from "../lib/googleCalendarTeam.js";

function asJson(v: unknown): object {
  return v as object;
}

function mergeToolConfig(existing: unknown, incoming: Record<string, unknown>): Record<string, unknown> {
  const e = existing && typeof existing === "object" ? { ...(existing as Record<string, unknown>) } : {};
  return { ...e, ...incoming };
}

function readGoogleOAuthCredentials(cfg: unknown): { clientId: string; clientSecret: string; refreshToken: string } {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  return {
    clientId: String(c.client_id ?? "").trim(),
    clientSecret: String(c.client_secret ?? "").trim(),
    refreshToken: String(c.refresh_token ?? "").trim(),
  };
}

function readAdminCalendars(cfg: unknown): Array<{ id: string; name: string }> {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const raw = Array.isArray(c.connectedCalendars) ? c.connectedCalendars : [];
  return raw
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((x) => ({ id: String(x.id ?? "").trim(), name: String(x.name ?? x.id ?? "Agenda").trim() }))
    .filter((x) => x.id);
}

function oauthRedirectHtml(input: { ok: boolean; toolId: string; message?: string; team?: boolean }): string {
  const origin = getWebAppPublicOrigin();
  const params = new URLSearchParams({
    googleCalendarOAuth: input.ok ? "success" : "error",
    toolId: input.toolId,
  });
  if (input.team) params.set("team", "1");
  if (input.message) params.set("message", input.message.slice(0, 200));
  const target = input.team
    ? `${origin}/calendar-connected?${params.toString()}`
    : `${origin}/automation?${params.toString()}`;
  const title = input.ok ? "Google Calendar ligado" : "Erro ao ligar Google Calendar";
  const body = input.ok
    ? input.team
      ? "A sua agenda Google foi ligada com sucesso. O agente já pode marcar eventos nesta conta."
      : "Conta Google ligada com sucesso. A redirecionar…"
    : `Não foi possível ligar a conta Google. ${input.message ?? ""}`.trim();
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${title}</title><meta http-equiv="refresh" content="0;url=${target}"></head><body><p>${body}</p><p><a href="${target}">Continuar</a></p></body></html>`;
}

function inviteLandingHtml(input: { label?: string; startUrl: string; expired?: boolean }): string {
  const title = input.expired ? "Convite expirado" : "Ligar Google Calendar";
  const body = input.expired
    ? "Este link de convite expirou ou foi revogado. Peça um novo link ao administrador."
    : `Foi convidado(a) a ligar a sua agenda Google${input.label ? ` (${input.label})` : ""}. O agente poderá marcar eventos nas suas agendas autorizadas.`;
  const button = input.expired
    ? ""
    : `<p><a href="${input.startUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Escolher conta Google</a></p>`;
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#111"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p>${button}</body></html>`;
}

async function loadGoogleCalendarTool(organizationId: string, toolId: string) {
  return prisma.automationCustomTool.findFirst({
    where: { id: toolId, organizationId, toolType: "GOOGLE_CALENDAR", isActive: true },
  });
}

async function persistAdminOAuthResult(input: {
  toolConfig: unknown;
  tokens: { accessToken: string; refreshToken?: string };
}): Promise<Record<string, unknown>> {
  const user = await fetchGoogleUserInfo(input.tokens.accessToken);
  let adminCalendars = readAdminCalendars(input.toolConfig);
  try {
    adminCalendars = await fetchGoogleCalendarList(input.tokens.accessToken);
  } catch {
    /* keep existing */
  }
  const teamMembers = readTeamMembers(input.toolConfig);
  const patch: Record<string, unknown> = {
    oauth_connected_at: new Date().toISOString(),
    adminAccount: {
      email: user.email,
      displayName: user.name,
      connectedAt: new Date().toISOString(),
    },
    connectedCalendars: rebuildConnectedCalendars({
      adminEmail: user.email,
      adminCalendars,
      teamMembers,
    }),
  };
  if (input.tokens.refreshToken) patch.refresh_token = input.tokens.refreshToken;
  const primary = adminCalendars.find((c) => c.id === "primary") ?? adminCalendars[0];
  if (primary) patch.calendar_id = primary.id;
  return patch;
}

async function persistTeamInviteOAuthResult(input: {
  toolConfig: unknown;
  tokens: { accessToken: string; refreshToken?: string };
}): Promise<Record<string, unknown>> {
  if (!input.tokens.refreshToken) {
    throw new Error("missing_refresh_token");
  }
  const user = await fetchGoogleUserInfo(input.tokens.accessToken);
  const calendars = await fetchGoogleCalendarList(input.tokens.accessToken);
  const teamMembers = readTeamMembers(input.toolConfig);
  const existingIdx = teamMembers.findIndex((m) => m.email.toLowerCase() === user.email.toLowerCase());
  const member: GoogleCalendarTeamMember = {
    memberId: existingIdx >= 0 ? teamMembers[existingIdx]!.memberId : randomUUID(),
    email: user.email,
    displayName: user.name,
    refresh_token: input.tokens.refreshToken,
    calendar_id: calendars.find((c) => c.primary)?.id ?? calendars[0]?.id ?? "primary",
    calendars: calendars.map((c) => ({ id: c.id, name: c.name })),
    connectedAt: new Date().toISOString(),
  };
  const nextMembers =
    existingIdx >= 0
      ? teamMembers.map((m, i) => (i === existingIdx ? member : m))
      : [...teamMembers, member];

  const creds = readGoogleOAuthCredentials(input.toolConfig);
  const adminCalendars = readAdminCalendars(input.toolConfig);
  const adminAccount =
    input.toolConfig && typeof input.toolConfig === "object"
      ? ((input.toolConfig as Record<string, unknown>).adminAccount as Record<string, unknown> | undefined)
      : undefined;
  const adminEmail = typeof adminAccount?.email === "string" ? adminAccount.email : undefined;

  return {
    teamMembers: nextMembers,
    connectedCalendars: rebuildConnectedCalendars({
      adminEmail,
      adminCalendars: creds.refreshToken ? adminCalendars : [],
      teamMembers: nextMembers,
    }),
  };
}

/** Callback público OAuth (registar no Google Cloud Console). */
export async function googleCalendarPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/integrations/google-calendar/invite/:token", async (request, reply) => {
    const token = String((request.params as { token: string }).token ?? "").trim();
    const invite = verifyTeamInviteToken(token);
    if (!invite) {
      return reply.type("text/html; charset=utf-8").send(inviteLandingHtml({ startUrl: "", expired: true }));
    }
    const tool = await prisma.automationCustomTool.findFirst({
      where: { id: invite.toolId, organizationId: invite.organizationId, toolType: "GOOGLE_CALENDAR" },
    });
    if (!tool) {
      return reply.type("text/html; charset=utf-8").send(inviteLandingHtml({ startUrl: "", expired: true }));
    }
    const invites = readTeamInvites(tool.config);
    const record = invites.find((x) => x.inviteId === invite.inviteId);
    if (!record || record.revoked) {
      return reply.type("text/html; charset=utf-8").send(inviteLandingHtml({ startUrl: "", expired: true }));
    }
    const startUrl = googleCalendarTeamInviteStartUrl(token);
    return reply
      .type("text/html; charset=utf-8")
      .send(inviteLandingHtml({ label: invite.label ?? record.label, startUrl }));
  });

  app.get("/api/v1/integrations/google-calendar/invite/:token/start", async (request, reply) => {
    const token = String((request.params as { token: string }).token ?? "").trim();
    const invite = verifyTeamInviteToken(token);
    if (!invite) {
      return reply.status(400).send({ error: "invalid_invite" });
    }
    const tool = await prisma.automationCustomTool.findFirst({
      where: { id: invite.toolId, organizationId: invite.organizationId, toolType: "GOOGLE_CALENDAR" },
    });
    if (!tool) return reply.status(404).send({ error: "tool_not_found" });
    const invites = readTeamInvites(tool.config);
    const record = invites.find((x) => x.inviteId === invite.inviteId);
    if (!record || record.revoked) return reply.status(410).send({ error: "invite_revoked" });

    const creds = readGoogleOAuthCredentials(tool.config);
    if (!creds.clientId || !creds.clientSecret) {
      return reply.status(503).send({ error: "tool_not_configured" });
    }

    const state = createGoogleOAuthState({
      organizationId: invite.organizationId,
      toolId: invite.toolId,
      mode: "team_invite",
      inviteId: invite.inviteId,
    });
    const url = buildGoogleOAuthAuthorizeUrl({ clientId: creds.clientId, state, selectAccount: true });
    return reply.redirect(url);
  });

  app.get("/api/v1/integrations/google-calendar/oauth/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    const state = verifyGoogleOAuthState(String(q.state ?? "").trim());
    const teamFlow = state?.mode === "team_invite";

    if (q.error) {
      const html = oauthRedirectHtml({
        ok: false,
        toolId: state?.toolId ?? "",
        message: q.error,
        team: teamFlow,
      });
      return reply.type("text/html; charset=utf-8").send(html);
    }
    const code = (q.code ?? "").trim();
    const stateRaw = (q.state ?? "").trim();
    if (!code || !state) {
      const html = oauthRedirectHtml({ ok: false, toolId: "", message: "invalid_oauth_state", team: teamFlow });
      return reply.type("text/html; charset=utf-8").send(html);
    }

    const tool = await prisma.automationCustomTool.findFirst({
      where: { id: state.toolId, organizationId: state.organizationId, toolType: "GOOGLE_CALENDAR" },
    });
    if (!tool) {
      const html = oauthRedirectHtml({ ok: false, toolId: state.toolId, message: "tool_not_found", team: teamFlow });
      return reply.type("text/html; charset=utf-8").send(html);
    }

    const creds = readGoogleOAuthCredentials(tool.config);
    if (!creds.clientId || !creds.clientSecret) {
      const html = oauthRedirectHtml({
        ok: false,
        toolId: tool.id,
        message: "missing_client_credentials",
        team: teamFlow,
      });
      return reply.type("text/html; charset=utf-8").send(html);
    }

    try {
      const tokens = await exchangeGoogleOAuthCode({
        code,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      });

      const patch =
        state.mode === "team_invite"
          ? await persistTeamInviteOAuthResult({ toolConfig: tool.config, tokens })
          : await persistAdminOAuthResult({ toolConfig: tool.config, tokens });

      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: { config: asJson(mergeToolConfig(tool.config, patch)) },
      });

      const html = oauthRedirectHtml({ ok: true, toolId: tool.id, team: teamFlow });
      return reply.type("text/html; charset=utf-8").send(html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const html = oauthRedirectHtml({ ok: false, toolId: tool.id, message: msg, team: teamFlow });
      return reply.type("text/html; charset=utf-8").send(html);
    }
  });
}

/** Rotas autenticadas para iniciar OAuth e consultar URL de callback. */
export async function googleCalendarAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  async function requireGoogleCalendarTool(
    request: { params: { id: string } },
    reply: FastifyReply,
    organizationId: string,
  ) {
    const tool = await loadGoogleCalendarTool(organizationId, request.params.id);
    if (!tool) {
      reply.status(404).send({ error: "Not Found", message: "Google Calendar tool not found", statusCode: 404 });
      return null;
    }
    return tool;
  }

  app.get<{ Params: { id: string } }>(
    "/custom-tools/:id/google-oauth/info",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const tool = await requireGoogleCalendarTool(request, reply, organizationId);
      if (!tool) return;

      const creds = readGoogleOAuthCredentials(tool.config);
      const hasClientCredentials = Boolean(creds.clientId && creds.clientSecret);
      const hasRefreshToken = Boolean(creds.refreshToken);
      const canStartOAuth = hasClientCredentials;
      const teamMembers = redactTeamMembersForClient(readTeamMembers(tool.config));
      const teamInvites = readTeamInvites(tool.config).filter((x) => !x.revoked);

      let authorizeUrl: string | null = null;
      if (canStartOAuth) {
        const state = createGoogleOAuthState({ organizationId, toolId: tool.id, mode: "admin" });
        authorizeUrl = buildGoogleOAuthAuthorizeUrl({ clientId: creds.clientId, state, selectAccount: true });
      }

      const cfg = tool.config && typeof tool.config === "object" ? (tool.config as Record<string, unknown>) : {};
      const adminAccount = cfg.adminAccount && typeof cfg.adminAccount === "object" ? cfg.adminAccount : null;

      return {
        callbackUrl: googleCalendarOAuthCallbackUrl(),
        scope: "https://www.googleapis.com/auth/calendar",
        hasClientCredentials,
        hasRefreshToken,
        canStartOAuth,
        authorizeUrl,
        adminAccount,
        teamMembers,
        teamInvites: teamInvites.map((x) => ({ inviteId: x.inviteId, label: x.label, createdAt: x.createdAt, expiresAt: x.expiresAt })),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/custom-tools/:id/google-oauth/start",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const tool = await requireGoogleCalendarTool(request, reply, organizationId);
      if (!tool) return;

      const creds = readGoogleOAuthCredentials(tool.config);
      if (!creds.clientId || !creds.clientSecret) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Configure client_id e client_secret antes de ligar a conta Google.",
          statusCode: 400,
        });
      }

      const state = createGoogleOAuthState({ organizationId, toolId: tool.id, mode: "admin" });
      const url = buildGoogleOAuthAuthorizeUrl({ clientId: creds.clientId, state, selectAccount: true });
      return reply.redirect(url);
    },
  );

  app.post<{ Params: { id: string }; Body: { label?: string; expiresInDays?: number } }>(
    "/custom-tools/:id/google-oauth/invite-link",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const tool = await requireGoogleCalendarTool(request, reply, organizationId);
      if (!tool) return;

      const creds = readGoogleOAuthCredentials(tool.config);
      if (!creds.clientId || !creds.clientSecret) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Configure OAuth antes de gerar convites.",
          statusCode: 400,
        });
      }

      const label = typeof request.body?.label === "string" ? request.body.label.trim() : "";
      const expiresInDays =
        typeof request.body?.expiresInDays === "number" && request.body.expiresInDays > 0
          ? Math.min(365, Math.floor(request.body.expiresInDays))
          : 30;
      const inviteId = randomUUID();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
      const invites = readTeamInvites(tool.config);
      const nextInvites = [...invites, { inviteId, label: label || undefined, createdAt, expiresAt }];
      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: { config: asJson(mergeToolConfig(tool.config, { teamInvites: nextInvites })) },
      });

      const signed = createTeamInviteToken({
        organizationId,
        toolId: tool.id,
        inviteId,
        label: label || undefined,
        expiresInMs: expiresInDays * 24 * 60 * 60 * 1000,
      });

      return {
        inviteId,
        inviteUrl: googleCalendarTeamInvitePublicUrl(signed),
        expiresAt,
        label: label || null,
      };
    },
  );

  app.delete<{ Params: { id: string; memberId: string } }>(
    "/custom-tools/:id/google-oauth/team-members/:memberId",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const tool = await requireGoogleCalendarTool(request, reply, organizationId);
      if (!tool) return;

      const teamMembers = readTeamMembers(tool.config).filter((m) => m.memberId !== request.params.memberId);
      const creds = readGoogleOAuthCredentials(tool.config);
      const adminAccount =
        tool.config && typeof tool.config === "object"
          ? ((tool.config as Record<string, unknown>).adminAccount as Record<string, unknown> | undefined)
          : undefined;
      const adminEmail = typeof adminAccount?.email === "string" ? adminAccount.email : undefined;
      const adminCalendars = creds.refreshToken ? readAdminCalendars(tool.config) : [];

      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: {
          config: asJson(
            mergeToolConfig(tool.config, {
              teamMembers,
              connectedCalendars: rebuildConnectedCalendars({ adminEmail, adminCalendars, teamMembers }),
            }),
          ),
        },
      });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/custom-tools/:id/google-oauth/sync-calendars",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const tool = await requireGoogleCalendarTool(request, reply, organizationId);
      if (!tool) return;

      const creds = readGoogleOAuthCredentials(tool.config);
      if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "google_calendar_not_connected",
          statusCode: 400,
        });
      }

      try {
        const accessToken = await refreshGoogleAccessToken({
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: creds.refreshToken,
        });
        const adminCalendars = await fetchGoogleCalendarList(accessToken);
        const teamMembers = readTeamMembers(tool.config);
        const adminAccount =
          tool.config && typeof tool.config === "object"
            ? ((tool.config as Record<string, unknown>).adminAccount as Record<string, unknown> | undefined)
            : undefined;
        const adminEmail = typeof adminAccount?.email === "string" ? adminAccount.email : undefined;
        const connectedCalendars = rebuildConnectedCalendars({ adminEmail, adminCalendars, teamMembers });
        const primary = adminCalendars.find((c) => c.primary) ?? adminCalendars[0];

        await prisma.automationCustomTool.update({
          where: { id: tool.id },
          data: {
            config: asJson(
              mergeToolConfig(tool.config, {
                connectedCalendars,
                ...(primary ? { calendar_id: primary.id } : {}),
              }),
            ),
          },
        });

        return { ok: true, connectedCalendars };
      } catch (err) {
        return reply.status(502).send({
          error: "Bad Gateway",
          message: err instanceof Error ? err.message : String(err),
          statusCode: 502,
        });
      }
    },
  );
}
