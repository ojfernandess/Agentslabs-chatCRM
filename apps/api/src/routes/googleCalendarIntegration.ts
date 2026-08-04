import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { getWebAppPublicOrigin, googleCalendarOAuthCallbackUrl } from "../config.js";
import {
  buildGoogleOAuthAuthorizeUrl,
  createGoogleOAuthState,
  exchangeGoogleOAuthCode,
  fetchGoogleCalendarList,
  refreshGoogleAccessToken,
  verifyGoogleOAuthState,
} from "../lib/googleCalendarOAuth.js";

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

function oauthRedirectHtml(input: { ok: boolean; toolId: string; message?: string }): string {
  const origin = getWebAppPublicOrigin();
  const params = new URLSearchParams({
    googleCalendarOAuth: input.ok ? "success" : "error",
    toolId: input.toolId,
  });
  if (input.message) params.set("message", input.message.slice(0, 200));
  const target = `${origin}/automation?${params.toString()}`;
  const title = input.ok ? "Google Calendar ligado" : "Erro ao ligar Google Calendar";
  const body = input.ok
    ? "Conta Google ligada com sucesso. A redirecionar…"
    : `Não foi possível ligar a conta Google. ${input.message ?? ""}`.trim();
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>${title}</title><meta http-equiv="refresh" content="0;url=${target}"></head><body><p>${body}</p><p><a href="${target}">Continuar</a></p></body></html>`;
}

async function loadGoogleCalendarTool(organizationId: string, toolId: string) {
  return prisma.automationCustomTool.findFirst({
    where: { id: toolId, organizationId, toolType: "GOOGLE_CALENDAR", isActive: true },
  });
}

/** Callback público OAuth (registar no Google Cloud Console). */
export async function googleCalendarPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/integrations/google-calendar/oauth/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    if (q.error) {
      const html = oauthRedirectHtml({ ok: false, toolId: "", message: q.error });
      return reply.type("text/html; charset=utf-8").send(html);
    }
    const code = (q.code ?? "").trim();
    const stateRaw = (q.state ?? "").trim();
    const state = verifyGoogleOAuthState(stateRaw);
    if (!code || !state) {
      const html = oauthRedirectHtml({ ok: false, toolId: "", message: "invalid_oauth_state" });
      return reply.type("text/html; charset=utf-8").send(html);
    }

    const tool = await prisma.automationCustomTool.findFirst({
      where: { id: state.toolId, organizationId: state.organizationId, toolType: "GOOGLE_CALENDAR" },
    });
    if (!tool) {
      const html = oauthRedirectHtml({ ok: false, toolId: state.toolId, message: "tool_not_found" });
      return reply.type("text/html; charset=utf-8").send(html);
    }

    const creds = readGoogleOAuthCredentials(tool.config);
    if (!creds.clientId || !creds.clientSecret) {
      const html = oauthRedirectHtml({
        ok: false,
        toolId: tool.id,
        message: "missing_client_credentials",
      });
      return reply.type("text/html; charset=utf-8").send(html);
    }

    try {
      const tokens = await exchangeGoogleOAuthCode({
        code,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      });
      let connectedCalendars: Array<{ id: string; name: string }> = [];
      try {
        connectedCalendars = await fetchGoogleCalendarList(tokens.accessToken);
      } catch {
        /* mantém connectedCalendars existentes se list falhar */
      }

      const patch: Record<string, unknown> = {
        oauth_connected_at: new Date().toISOString(),
      };
      if (tokens.refreshToken) patch.refresh_token = tokens.refreshToken;
      if (connectedCalendars.length > 0) {
        patch.connectedCalendars = connectedCalendars;
        const primary = connectedCalendars.find((c) => c.id === "primary") ?? connectedCalendars[0];
        if (primary) patch.calendar_id = primary.id;
      }

      await prisma.automationCustomTool.update({
        where: { id: tool.id },
        data: {
          config: asJson(mergeToolConfig(tool.config, patch)),
        },
      });

      const html = oauthRedirectHtml({ ok: true, toolId: tool.id });
      return reply.type("text/html; charset=utf-8").send(html);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const html = oauthRedirectHtml({ ok: false, toolId: tool.id, message: msg });
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

      let authorizeUrl: string | null = null;
      if (canStartOAuth) {
        const state = createGoogleOAuthState({ organizationId, toolId: tool.id });
        authorizeUrl = buildGoogleOAuthAuthorizeUrl({ clientId: creds.clientId, state });
      }

      return {
        callbackUrl: googleCalendarOAuthCallbackUrl(),
        scope: "https://www.googleapis.com/auth/calendar",
        hasClientCredentials,
        hasRefreshToken,
        canStartOAuth,
        authorizeUrl,
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

      const state = createGoogleOAuthState({ organizationId, toolId: tool.id });
      const url = buildGoogleOAuthAuthorizeUrl({ clientId: creds.clientId, state });
      return reply.redirect(url);
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
        const connectedCalendars = await fetchGoogleCalendarList(accessToken);
        const patch: Record<string, unknown> = { connectedCalendars };
        const primary = connectedCalendars.find((c) => c.primary) ?? connectedCalendars[0];
        if (primary) patch.calendar_id = primary.id;

        await prisma.automationCustomTool.update({
          where: { id: tool.id },
          data: { config: asJson(mergeToolConfig(tool.config, patch)) },
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
