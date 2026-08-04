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
  GOOGLE_OAUTH_SCOPES,
  humanizeGoogleOAuthError,
  refreshGoogleAccessToken,
  verifyGoogleOAuthState,
} from "../lib/googleCalendarOAuth.js";
import {
  calendarEntryKey,
  createTeamInviteToken,
  googleCalendarTeamInvitePublicUrl,
  googleCalendarTeamInviteStartUrl,
  indexConnectedCalendarNames,
  readTeamInvites,
  readTeamMembers,
  rebuildConnectedCalendars,
  redactTeamMembersForClient,
  verifyTeamInviteToken,
  type GoogleCalendarConnectedEntry,
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

function readConnectedCalendars(cfg: unknown): GoogleCalendarConnectedEntry[] {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const raw = Array.isArray(c.connectedCalendars) ? c.connectedCalendars : [];
  return raw
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((x) => ({
      id: String(x.id ?? "").trim(),
      name: String(x.name ?? x.id ?? "Agenda").trim(),
      memberId: typeof x.memberId === "string" ? x.memberId : undefined,
      email: typeof x.email === "string" ? x.email : undefined,
    }))
    .filter((x) => x.id);
}

function readAdminAccount(cfg: unknown): { email?: string; displayName?: string } | null {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const adminAccount =
    c.adminAccount && typeof c.adminAccount === "object"
      ? (c.adminAccount as Record<string, unknown>)
      : null;
  if (!adminAccount) return null;
  return {
    email: typeof adminAccount.email === "string" ? adminAccount.email : undefined,
    displayName: typeof adminAccount.displayName === "string" ? adminAccount.displayName : undefined,
  };
}

function readAdminGoogleCalendars(cfg: unknown): Array<{ id: string; name: string }> {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const raw = Array.isArray(c.adminCalendars) ? c.adminCalendars : [];
  const fromField = raw
    .filter((x): x is Record<string, unknown> => x && typeof x === "object")
    .map((x) => ({ id: String(x.id ?? "").trim(), name: String(x.name ?? x.id ?? "Agenda").trim() }))
    .filter((x) => x.id);
  if (fromField.length > 0) return fromField;
  return readConnectedCalendars(cfg)
    .filter((entry) => (entry.memberId ?? "admin") === "admin")
    .map((entry) => ({ id: entry.id, name: entry.name }));
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

function inviteLandingHtml(input: {
  label?: string;
  startUrl: string;
  expired?: boolean;
  organizationName?: string;
  organizationLogoUrl?: string | null;
}): string {
  const orgName = input.organizationName?.trim() || "OpenNexo";
  const title = input.expired ? "Convite expirado" : "Ligar Google Calendar";
  const subtitle = input.expired
    ? "Este link de convite expirou ou foi revogado."
    : `Foi convidado(a) a ligar a sua agenda Google${input.label ? ` · ${input.label}` : ""}.`;
  const detail = input.expired
    ? "Peça um novo link ao administrador da sua organização."
    : "Após autorizar, o agente poderá marcar eventos nas agendas que escolher — de forma segura e controlada.";
  const logoBlock = input.organizationLogoUrl
    ? `<img src="${escapeHtmlAttr(input.organizationLogoUrl)}" alt="${escapeHtmlAttr(orgName)}" class="logo" />`
    : `<div class="logo-fallback" aria-hidden="true">${escapeHtmlText(orgName.slice(0, 1).toUpperCase())}</div>`;
  const button = input.expired
    ? ""
    : `<a class="cta" href="${escapeHtmlAttr(input.startUrl)}">Escolher conta Google</a>`;
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlText(title)} · ${escapeHtmlText(orgName)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f4f6fb;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --brand: #2563eb;
      --brand-hover: #1d4ed8;
      --shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b1220;
        --card: #111827;
        --text: #f8fafc;
        --muted: #94a3b8;
        --border: #1f2937;
        --shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at top, rgba(37, 99, 235, 0.08), transparent 42%), var(--bg);
      color: var(--text);
      display: grid;
      place-items: center;
      padding: 24px 16px;
    }
    .card {
      width: min(100%, 440px);
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--shadow);
      padding: 32px 28px 28px;
      text-align: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      object-fit: contain;
      border-radius: 16px;
      margin: 0 auto 16px;
      display: block;
      background: #fff;
      padding: 8px;
    }
    .logo-fallback {
      width: 72px;
      height: 72px;
      border-radius: 16px;
      margin: 0 auto 16px;
      display: grid;
      place-items: center;
      font-size: 1.75rem;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
    }
    .org { margin: 0; font-size: 0.8125rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
    h1 { margin: 8px 0 0; font-size: 1.5rem; line-height: 1.25; font-weight: 700; }
    .subtitle { margin: 12px 0 0; font-size: 1rem; line-height: 1.5; color: var(--text); }
    .detail { margin: 10px 0 0; font-size: 0.9375rem; line-height: 1.55; color: var(--muted); }
    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 28px;
      min-height: 48px;
      padding: 0 22px;
      border-radius: 12px;
      background: var(--brand);
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.9375rem;
      transition: background 0.15s ease;
    }
    .cta:hover { background: var(--brand-hover); }
    .footer { margin-top: 24px; font-size: 0.75rem; color: var(--muted); }
  </style>
</head>
<body>
  <main class="card">
    ${logoBlock}
    <p class="org">${escapeHtmlText(orgName)}</p>
    <h1>${escapeHtmlText(title)}</h1>
    <p class="subtitle">${escapeHtmlText(subtitle)}</p>
    <p class="detail">${escapeHtmlText(detail)}</p>
    ${button}
    <p class="footer">Integração Google Calendar · OAuth seguro</p>
  </main>
</body>
</html>`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replace(/'/g, "&#39;");
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
  let adminCalendars = readAdminGoogleCalendars(input.toolConfig);
  try {
    adminCalendars = await fetchGoogleCalendarList(input.tokens.accessToken);
  } catch {
    /* keep existing */
  }
  const teamMembers = readTeamMembers(input.toolConfig);
  const adminAccount = readAdminAccount(input.toolConfig);
  const preserveNames = indexConnectedCalendarNames(readConnectedCalendars(input.toolConfig));
  const patch: Record<string, unknown> = {
    oauth_connected_at: new Date().toISOString(),
    adminAccount: {
      email: user.email,
      displayName: adminAccount?.displayName?.trim() || user.name,
      connectedAt: new Date().toISOString(),
    },
    adminCalendars: adminCalendars.map((c) => ({ id: c.id, name: c.name })),
    connectedCalendars: rebuildConnectedCalendars({
      adminEmail: user.email,
      adminDisplayName: adminAccount?.displayName?.trim() || user.name,
      adminCalendars,
      teamMembers,
      preserveNames,
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
  const adminAccount = readAdminAccount(input.toolConfig);
  const adminEmail = adminAccount?.email;
  const adminCalendars = creds.refreshToken ? readAdminGoogleCalendars(input.toolConfig) : [];
  const preserveNames = indexConnectedCalendarNames(readConnectedCalendars(input.toolConfig));

  return {
    teamMembers: nextMembers,
    connectedCalendars: rebuildConnectedCalendars({
      adminEmail,
      adminDisplayName: adminAccount?.displayName,
      adminCalendars,
      teamMembers: nextMembers,
      preserveNames,
    }),
  };
}

function readInviteTokenFromRequest(request: {
  params: unknown;
  query: unknown;
}): string {
  const q = request.query as { token?: string };
  if (typeof q.token === "string" && q.token.trim()) {
    try {
      return decodeURIComponent(q.token.trim());
    } catch {
      return q.token.trim();
    }
  }
  const params = request.params as { token?: string };
  if (typeof params.token === "string" && params.token.trim()) {
    return params.token.trim();
  }
  return "";
}

async function renderInviteLanding(token: string, reply: FastifyReply) {
  const invite = verifyTeamInviteToken(token);
  if (!invite) {
    return reply.type("text/html; charset=utf-8").send(inviteLandingHtml({ startUrl: "", expired: true }));
  }
  const [tool, organization, settings] = await Promise.all([
    prisma.automationCustomTool.findFirst({
      where: { id: invite.toolId, organizationId: invite.organizationId, toolType: "GOOGLE_CALENDAR" },
    }),
    prisma.organization.findUnique({
      where: { id: invite.organizationId },
      select: { name: true },
    }),
    prisma.settings.findUnique({
      where: { organizationId: invite.organizationId },
      select: { organizationLogoUrl: true },
    }),
  ]);
  if (!tool) {
    return reply.type("text/html; charset=utf-8").send(
      inviteLandingHtml({
        startUrl: "",
        expired: true,
        organizationName: organization?.name,
        organizationLogoUrl: settings?.organizationLogoUrl ?? null,
      }),
    );
  }
  const invites = readTeamInvites(tool.config);
  const record = invites.find((x) => x.inviteId === invite.inviteId);
  if (!record || record.revoked) {
    return reply.type("text/html; charset=utf-8").send(
      inviteLandingHtml({
        startUrl: "",
        expired: true,
        organizationName: organization?.name,
        organizationLogoUrl: settings?.organizationLogoUrl ?? null,
      }),
    );
  }
  const startUrl = googleCalendarTeamInviteStartUrl(token);
  return reply.type("text/html; charset=utf-8").send(
    inviteLandingHtml({
      label: invite.label ?? record.label,
      startUrl,
      organizationName: organization?.name,
      organizationLogoUrl: settings?.organizationLogoUrl ?? null,
    }),
  );
}

async function startInviteOAuth(token: string, reply: FastifyReply) {
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
  const url = buildGoogleOAuthAuthorizeUrl({
    clientId: creds.clientId,
    state,
    selectAccount: true,
    forceConsent: true,
  });
  return reply.redirect(url);
}

/** Callback público OAuth (registar no Google Cloud Console). */
export async function googleCalendarPublicRoutes(app: FastifyInstance): Promise<void> {
  // Preferido: ?token=… (evita problemas de proxy/path com caracteres especiais)
  app.get("/api/v1/integrations/google-calendar/invite", async (request, reply) => {
    const token = readInviteTokenFromRequest(request);
    if (!token) return reply.status(400).send({ error: "missing_token" });
    return renderInviteLanding(token, reply);
  });

  app.get("/api/v1/integrations/google-calendar/invite/start", async (request, reply) => {
    const token = readInviteTokenFromRequest(request);
    if (!token) return reply.status(400).send({ error: "missing_token" });
    return startInviteOAuth(token, reply);
  });

  // Compatibilidade: links antigos /invite/:token
  app.get("/api/v1/integrations/google-calendar/invite/:token", async (request, reply) => {
    const token = readInviteTokenFromRequest(request);
    if (!token) return reply.status(400).send({ error: "missing_token" });
    return renderInviteLanding(token, reply);
  });

  app.get("/api/v1/integrations/google-calendar/invite/:token/start", async (request, reply) => {
    const token = readInviteTokenFromRequest(request);
    if (!token) return reply.status(400).send({ error: "missing_token" });
    return startInviteOAuth(token, reply);
  });

  app.get("/api/v1/integrations/google-calendar/oauth/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    const state = verifyGoogleOAuthState(String(q.state ?? "").trim());
    const teamFlow = state?.mode === "team_invite";

    if (q.error) {
      const html = oauthRedirectHtml({
        ok: false,
        toolId: state?.toolId ?? "",
        message: humanizeGoogleOAuthError(String(q.error)),
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
        message: humanizeGoogleOAuthError("missing_client_credentials"),
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
      const msg = humanizeGoogleOAuthError(err instanceof Error ? err.message : String(err));
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
        authorizeUrl = buildGoogleOAuthAuthorizeUrl({
          clientId: creds.clientId,
          state,
          selectAccount: true,
          forceConsent: !hasRefreshToken,
        });
      }

      const adminAccount = readAdminAccount(tool.config);
      const connectedCalendars = readConnectedCalendars(tool.config);

      return {
        callbackUrl: googleCalendarOAuthCallbackUrl(),
        scope: GOOGLE_OAUTH_SCOPES,
        hasClientCredentials,
        hasRefreshToken,
        canStartOAuth,
        authorizeUrl,
        adminAccount,
        connectedCalendars,
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
      const url = buildGoogleOAuthAuthorizeUrl({
        clientId: creds.clientId,
        state,
        selectAccount: true,
        forceConsent: !creds.refreshToken,
      });
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
      const adminAccount = readAdminAccount(tool.config);
      const adminCalendars = creds.refreshToken ? readAdminGoogleCalendars(tool.config) : [];
      const preserveNames = indexConnectedCalendarNames(readConnectedCalendars(tool.config));

      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: {
          config: asJson(
            mergeToolConfig(tool.config, {
              teamMembers,
              connectedCalendars: rebuildConnectedCalendars({
                adminEmail: adminAccount?.email,
                adminDisplayName: adminAccount?.displayName,
                adminCalendars,
                teamMembers,
                preserveNames,
              }),
            }),
          ),
        },
      });
      return { ok: true };
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      adminDisplayName?: string;
      memberDisplayNames?: Array<{ memberId: string; displayName: string }>;
      calendarNames?: Array<{ memberId: string; calendarId: string; name: string }>;
    };
  }>(
    "/custom-tools/:id/google-oauth/display-names",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      const tool = await requireGoogleCalendarTool(request, reply, organizationId);
      if (!tool) return;

      const cfg = tool.config && typeof tool.config === "object" ? { ...(tool.config as Record<string, unknown>) } : {};
      const adminAccount = readAdminAccount(tool.config);
      const teamMembers = readTeamMembers(tool.config);
      const preserveNames = indexConnectedCalendarNames(readConnectedCalendars(tool.config));

      if (typeof request.body?.adminDisplayName === "string") {
        const displayName = request.body.adminDisplayName.trim();
        cfg.adminAccount = {
          ...(adminAccount ?? {}),
          displayName: displayName || undefined,
        };
      }

      const memberNameUpdates = Array.isArray(request.body?.memberDisplayNames)
        ? request.body.memberDisplayNames
        : [];
      const nextMembers = teamMembers.map((member) => {
        const update = memberNameUpdates.find((row) => row.memberId === member.memberId);
        if (!update || typeof update.displayName !== "string") return member;
        const displayName = update.displayName.trim();
        return { ...member, displayName: displayName || undefined };
      });
      cfg.teamMembers = nextMembers;

      const calendarNameUpdates = Array.isArray(request.body?.calendarNames) ? request.body.calendarNames : [];
      for (const row of calendarNameUpdates) {
        const memberId = String(row.memberId ?? "").trim();
        const calendarId = String(row.calendarId ?? "").trim();
        const name = String(row.name ?? "").trim();
        if (!memberId || !calendarId || !name) continue;
        preserveNames.set(calendarEntryKey(memberId, calendarId), name);
      }

      const creds = readGoogleOAuthCredentials(tool.config);
      const nextAdminAccount = readAdminAccount(cfg);
      const connectedCalendars = rebuildConnectedCalendars({
        adminEmail: nextAdminAccount?.email,
        adminDisplayName: nextAdminAccount?.displayName,
        adminCalendars: creds.refreshToken ? readAdminGoogleCalendars(tool.config) : [],
        teamMembers: nextMembers,
        preserveNames,
      });

      cfg.connectedCalendars = connectedCalendars;
      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: { config: asJson(cfg) },
      });

      return { ok: true, connectedCalendars, adminAccount: nextAdminAccount, teamMembers: redactTeamMembersForClient(nextMembers) };
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
        const adminAccount = readAdminAccount(tool.config);
        const preserveNames = indexConnectedCalendarNames(readConnectedCalendars(tool.config));
        const connectedCalendars = rebuildConnectedCalendars({
          adminEmail: adminAccount?.email,
          adminDisplayName: adminAccount?.displayName,
          adminCalendars,
          teamMembers,
          preserveNames,
        });
        const primary = adminCalendars.find((c) => c.primary) ?? adminCalendars[0];

        await prisma.automationCustomTool.update({
          where: { id: tool.id },
          data: {
            config: asJson(
              mergeToolConfig(tool.config, {
                adminCalendars: adminCalendars.map((c) => ({ id: c.id, name: c.name })),
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
