import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, WebchatSession } from "@prisma/client";
import { prisma } from "../db.js";
import { getWebAppPublicOrigin } from "../config.js";
import { appendTimelineEvent } from "./timeline.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";

/**
 * Web Chat externo — continuidade da MESMA conversa (nunca cria uma segunda Conversation).
 *
 * Token seguro: aleatório, não enumerável, vinculado à conversa + organização, expirável e revogável.
 * A URL nunca expõe organization_id / conversation_id / contact_id.
 */

export const WEBCHAT_DEFAULT_EXPIRATION_HOURS = 24;

export function newWebchatToken(): string {
  return randomBytes(32).toString("base64url");
}

export function webchatPublicUrl(token: string): string {
  return `${getWebAppPublicOrigin()}/s/${encodeURIComponent(token)}`;
}

export function isWebchatSessionExpired(session: Pick<WebchatSession, "expiresAt">): boolean {
  return session.expiresAt.getTime() <= Date.now();
}

const DEFAULT_CONTINUITY_MESSAGE =
  "Para continuar seu atendimento pelo navegador, acesse o link abaixo:\n\n{{webchat_url}}";

/** Substitui {{webchat_url}} exclusivamente pelo link seguro gerado pelo sistema. */
export function buildWebchatContinuityBody(templateText: string | null | undefined, url: string): string {
  const base = (templateText ?? "").trim() || DEFAULT_CONTINUITY_MESSAGE;
  if (base.includes("{{webchat_url}}")) {
    return base.split("{{webchat_url}}").join(url);
  }
  return `${base}\n\n${url}`;
}

export function replyContainsWebchatUrl(text: string, url?: string | null): boolean {
  if (url && text.includes(url)) return true;
  return /\/s\/[A-Za-z0-9_-]{8,}/.test(text);
}

export type GenerateWebchatLinkResult =
  | {
      ok: true;
      session: WebchatSession;
      url: string;
      reused: boolean;
    }
  | { ok: false; code: "FEATURE_DISABLED" | "CONVERSATION_NOT_FOUND"; message: string };

async function orgWebchatSettings(organizationId: string): Promise<{
  expirationHours: number;
  regeneratePolicy: "revoke" | "keep";
  continuityMessage: string | null;
}> {
  const s = await prisma.settings.findUnique({
    where: { organizationId },
    select: {
      webchatLinkExpirationHours: true,
      webchatContinuityMessage: true,
      webchatRegeneratePolicy: true,
    },
  });
  const hours = s?.webchatLinkExpirationHours ?? WEBCHAT_DEFAULT_EXPIRATION_HOURS;
  return {
    expirationHours: Math.max(1, Math.min(720, hours)),
    regeneratePolicy: s?.webchatRegeneratePolicy === "keep" ? "keep" : "revoke",
    continuityMessage: s?.webchatContinuityMessage ?? null,
  };
}

export async function getActiveWebchatSessionForConversation(
  organizationId: string,
  conversationId: string,
): Promise<WebchatSession | null> {
  const session = await prisma.webchatSession.findFirst({
    where: { organizationId, conversationId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!session) return null;
  if (isWebchatSessionExpired(session)) {
    await prisma.webchatSession
      .update({ where: { id: session.id }, data: { status: "EXPIRED", updatedAt: new Date() } })
      .catch(() => {});
    return null;
  }
  return session;
}

export async function resetWebchatClientBinding(sessionId: string): Promise<void> {
  await prisma.webchatSession.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: { clientSessionHash: null, claimedAt: null, updatedAt: new Date() },
  });
}

/**
 * Gera (ou reutiliza) o link seguro do Web Chat para a conversa.
 * Reutiliza sessão ACTIVE válida por padrão — evita múltiplos tokens desnecessários a cada clique.
 */
export async function generateWebchatLinkForConversation(params: {
  organizationId: string;
  conversationId: string;
  createdBySource: "AGENT" | "HUMAN" | "SYSTEM";
  createdByUserId?: string | null;
  /** true força novo token; a política da organização decide se o anterior é revogado ou mantido. */
  regenerate?: boolean;
  /** Limpa o vínculo do dispositivo — usar ao enviar o link ao cliente para permitir nova abertura. */
  resetClientBinding?: boolean;
}): Promise<GenerateWebchatLinkResult> {
  const { organizationId, conversationId } = params;

  if (!(await isOrganizationFeatureEnabled(organizationId, "webchat"))) {
    return { ok: false, code: "FEATURE_DISABLED", message: "Web Chat is not enabled for this organization" };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { id: true, contactId: true, inbox: { select: { channelType: true } } },
  });
  if (!conversation) {
    return { ok: false, code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" };
  }

  const settings = await orgWebchatSettings(organizationId);

  const existing = await getActiveWebchatSessionForConversation(organizationId, conversationId);
  if (existing && !params.regenerate) {
    if (params.resetClientBinding) {
      await resetWebchatClientBinding(existing.id);
    }
    return {
      ok: true,
      session: {
        ...existing,
        ...(params.resetClientBinding ? { clientSessionHash: null, claimedAt: null } : {}),
      },
      url: webchatPublicUrl(existing.token),
      reused: true,
    };
  }

  if (params.regenerate) {
    await prisma.webchatSession.updateMany({
      where: { organizationId, conversationId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() },
    });
  }

  const expiresAt = new Date(Date.now() + settings.expirationHours * 60 * 60 * 1000);
  const session = await prisma.webchatSession.create({
    data: {
      organizationId,
      conversationId,
      contactId: conversation.contactId,
      token: newWebchatToken(),
      status: "ACTIVE",
      expiresAt,
      createdBySource: params.createdBySource,
      createdByUserId: params.createdByUserId ?? null,
    },
  });

  /** Evento interno discreto — sem o token completo (risco de reutilização do link). */
  await appendTimelineEvent({
    organizationId,
    subjectType: "CONTACT",
    subjectId: conversation.contactId,
    eventType: "webchat.link_generated",
    channel: "webchat",
    payload: {
      conversationId,
      generatedBy: params.createdBySource,
      generatedByUserId: params.createdByUserId ?? null,
      expiresAt: expiresAt.toISOString(),
      channel: conversation.inbox.channelType,
      organizationId,
    } as Prisma.InputJsonValue,
    actorUserId: params.createdByUserId ?? undefined,
    sourceId: session.id,
  }).catch(() => {});

  return { ok: true, session, url: webchatPublicUrl(session.token), reused: false };
}

export async function revokeWebchatSessionForConversation(
  organizationId: string,
  conversationId: string,
): Promise<number> {
  const r = await prisma.webchatSession.updateMany({
    where: { organizationId, conversationId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), updatedAt: new Date() },
  });
  return r.count;
}

export function hashWebchatClientSession(secret: string): string {
  return createHash("sha256").update(secret.trim()).digest("hex");
}

function clientSessionHashesMatch(stored: string, computed: string): boolean {
  if (stored.length !== computed.length) return false;
  try {
    return timingSafeEqual(Buffer.from(stored, "utf8"), Buffer.from(computed, "utf8"));
  } catch {
    return false;
  }
}

export type WebchatClientBindingMode = "read" | "write";

async function claimWebchatClientSession(
  sessionId: string,
  secret: string,
): Promise<{ ok: true } | { ok: false; code: "SESSION_CLAIMED" }> {
  const hash = hashWebchatClientSession(secret);
  const claimed = await prisma.webchatSession.updateMany({
    where: { id: sessionId, status: "ACTIVE", clientSessionHash: null },
    data: {
      clientSessionHash: hash,
      claimedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
  if (claimed.count === 1) return { ok: true };

  const fresh = await prisma.webchatSession.findUnique({ where: { id: sessionId } });
  if (!fresh?.clientSessionHash || !clientSessionHashesMatch(fresh.clientSessionHash, hash)) {
    return { ok: false, code: "SESSION_CLAIMED" };
  }
  return { ok: true };
}

async function verifyWebchatClientSessionBinding(
  session: WebchatSession,
  clientSessionSecret: string | null | undefined,
  mode: WebchatClientBindingMode,
): Promise<{ ok: true } | { ok: false; code: "SESSION_CLAIMED" | "CLIENT_SESSION_REQUIRED" }> {
  const secret = clientSessionSecret?.trim();

  if (!session.clientSessionHash) {
    if (mode === "read") return { ok: true };
    if (!secret) return { ok: false, code: "CLIENT_SESSION_REQUIRED" };
    return claimWebchatClientSession(session.id, secret);
  }

  if (!secret) return { ok: false, code: "SESSION_CLAIMED" };
  if (!clientSessionHashesMatch(session.clientSessionHash, hashWebchatClientSession(secret))) {
    return { ok: false, code: "SESSION_CLAIMED" };
  }
  return { ok: true };
}

export type ResolveWebchatSessionResult =
  | { ok: false; code: "NOT_FOUND" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "SESSION_CLAIMED" | "CLIENT_SESSION_REQUIRED" }
  | {
      ok: true;
      session: WebchatSession;
      conversation: { id: string; organizationId: string; contactId: string; inboxId: string };
      organizationName: string;
      organizationLogoUrl: string | null;
      agentBotName: string | null;
    };

/**
 * Resolve o token público. Um token nunca pode aceder a outra conversa/organização:
 * a conversa devolvida é exclusivamente a vinculada à sessão.
 */
export async function resolveWebchatSessionByToken(
  token: string,
  clientSessionSecret?: string | null,
  options?: { bindingMode?: WebchatClientBindingMode },
): Promise<ResolveWebchatSessionResult> {
  const bindingMode = options?.bindingMode ?? "read";
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 16 || trimmed.length > 96) return { ok: false, code: "NOT_FOUND" };

  const session = await prisma.webchatSession.findUnique({ where: { token: trimmed } });
  if (!session) return { ok: false, code: "NOT_FOUND" };
  if (session.status === "REVOKED") return { ok: false, code: "SESSION_REVOKED" };
  if (session.status === "EXPIRED" || isWebchatSessionExpired(session)) {
    if (session.status !== "EXPIRED") {
      await prisma.webchatSession
        .update({ where: { id: session.id }, data: { status: "EXPIRED", updatedAt: new Date() } })
        .catch(() => {});
    }
    return { ok: false, code: "SESSION_EXPIRED" };
  }

  const binding = await verifyWebchatClientSessionBinding(session, clientSessionSecret, bindingMode);
  if (!binding.ok) return binding;

  const conversation = await prisma.conversation.findFirst({
    where: { id: session.conversationId, organizationId: session.organizationId, deletedAt: null },
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      inboxId: true,
      organization: { select: { name: true, isActive: true } },
    },
  });
  if (!conversation || !conversation.organization.isActive) return { ok: false, code: "NOT_FOUND" };

  const settings = await prisma.settings.findUnique({
    where: { organizationId: session.organizationId },
    select: {
      organizationLogoUrl: true,
      agentBot: { select: { name: true } },
    },
  });

  await prisma.webchatSession
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    session,
    conversation: {
      id: conversation.id,
      organizationId: conversation.organizationId,
      contactId: conversation.contactId,
      inboxId: conversation.inboxId,
    },
    organizationName: conversation.organization.name,
    organizationLogoUrl: settings?.organizationLogoUrl ?? null,
    agentBotName: settings?.agentBot?.name ?? null,
  };
}

/** Acrescenta o link do Web Chat ao texto da resposta quando ainda não presente. */
export async function enrichReplyWithWebchatLink(params: {
  organizationId: string;
  conversationId: string;
  replyText: string;
}): Promise<{ replyText: string; url: string | null }> {
  const trimmed = params.replyText.trim();
  const link = await generateWebchatLinkForConversation({
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    createdBySource: "AGENT",
    resetClientBinding: true,
  });
  if (!link.ok) return { replyText: params.replyText, url: null };
  if (replyContainsWebchatUrl(trimmed, link.url)) return { replyText: params.replyText, url: link.url };
  const settings = await orgWebchatSettings(params.organizationId);
  const continuity = buildWebchatContinuityBody(settings.continuityMessage, link.url);
  return { replyText: trimmed ? `${trimmed}\n\n${continuity}` : continuity, url: link.url };
}

/** Envia a mensagem de continuidade do Web Chat ao contacto (fallback quando o modelo não inclui o link). */
export async function sendWebchatContinuityLinkToContact(params: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  botId: string;
  log: import("fastify").FastifyBaseLogger;
  skipIfBodyContains?: string;
}): Promise<{ sent: boolean; url?: string; messageId?: string }> {
  if (params.skipIfBodyContains && replyContainsWebchatUrl(params.skipIfBodyContains)) {
    return { sent: false };
  }
  const link = await generateWebchatLinkForConversation({
    organizationId: params.organizationId,
    conversationId: params.conversationId,
    createdBySource: "AGENT",
    regenerate: true,
    resetClientBinding: true,
  });
  if (!link.ok) return { sent: false };

  const settings = await orgWebchatSettings(params.organizationId);
  const body = buildWebchatContinuityBody(settings.continuityMessage, link.url);

  const { deliverOutboundWhatsAppMessage } = await import("./outboundMessage.js");
  const sent = await deliverOutboundWhatsAppMessage({
    organizationId: params.organizationId,
    data: {
      contactId: params.contactId,
      conversationId: params.conversationId,
      type: "TEXT",
      body,
    },
    actor: { kind: "agent_bot", botId: params.botId },
    log: params.log,
    newConversation: { status: "PENDING", assignedToId: null },
  });

  await appendTimelineEvent({
    organizationId: params.organizationId,
    subjectType: "CONTACT",
    subjectId: params.contactId,
    eventType: "webchat.link_sent",
    channel: "webchat",
    payload: {
      conversationId: params.conversationId,
      sentByBotId: params.botId,
      expiresAt: link.session.expiresAt.toISOString(),
      automatic: true,
    } as Prisma.InputJsonValue,
    sourceId: sent.message.id,
  }).catch(() => {});

  return { sent: true, url: link.url, messageId: sent.message.id };
}
