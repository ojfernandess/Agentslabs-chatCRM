import type { FastifyInstance } from "fastify";
import { getWebAppPublicOrigin } from "../config.js";
import { prisma } from "../db.js";
import { findContactByInboundPhone } from "./contactPhoneMatch.js";
import { appendTimelineEvent } from "./timeline.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { decryptThreeCxSecret } from "./threeCxConfig.js";
import { normalizeDialPhone, resolveThreeCxCallContext } from "./threeCxCallContext.js";
import {
  normalizeThreeCxTerminalStatus,
  upsertThreeCxTimelineMessage,
} from "./threeCxCallTimeline.js";
import { broadcastConversationUpdated, broadcastToOrganization } from "./workspaceHub.js";
import { resolveIncomingCallTargetUserIds } from "./wavoipIncomingQueue.js";
import { writeThreeCxIntegrationLog } from "./threeCxIntegrationLog.js";
import { findProvisionalThreeCxCallLog } from "./threeCxAgentCall.js";
import { fireTelephonyCrmTriggers } from "./crmFlowTelephonyHooks.js";

function crmAuthHeader(request: { headers: Record<string, unknown> }): string | null {
  const raw =
    (request.headers["x-threecx-api-key"] as string | undefined) ??
    (request.headers["authorization"] as string | undefined);
  if (!raw?.trim()) return null;
  if (raw.toLowerCase().startsWith("bearer ")) return raw.slice(7).trim();
  return raw.trim();
}

export function verifyThreeCxCrmApiKey(
  routePoint: { crmApiKeyEnc: string },
  provided: string | null,
): boolean {
  if (!provided) return false;
  const expected = decryptThreeCxSecret(routePoint.crmApiKeyEnc);
  if (!expected) return false;
  return provided === expected;
}

function contactUrl(organizationId: string, contactId: string): string {
  void organizationId;
  return `${getWebAppPublicOrigin()}/contacts/${contactId}`;
}

function splitContactName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Contacto", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

/** Formato esperado pelo template CRM 3CX (Contact ID, First/Last Name, Email, phones, URL). */
export function threeCxCrmContactPayload(
  organizationId: string,
  contact: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
  },
) {
  const { firstName, lastName } = splitContactName(contact.name);
  const url = contactUrl(organizationId, contact.id);
  return {
    ContactID: contact.id,
    FirstName: firstName,
    LastName: lastName,
    CompanyName: "",
    Email: contact.email?.trim() || `${contact.id}@openconduit.local`,
    BusinessPhone: contact.phone,
    MobilePhone: contact.phone,
    ContactURL: url,
    contact_url: url,
  };
}

export async function lookupContactByNumber(input: {
  organizationId: string;
  routePointId: string;
  number: string;
  interactionType?: string;
}): Promise<{ found: boolean; contact?: ReturnType<typeof threeCxCrmContactPayload> }> {
  const phone = normalizeDialPhone(input.number) ?? input.number.trim();
  const found = phone
    ? await findContactByInboundPhone(prisma, input.organizationId, phone)
    : null;

  if (!found) {
    if (input.interactionType?.toLowerCase().includes("inbound")) {
      await registerInboundRinging(input);
    }
    return { found: false };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: found.id, organizationId: input.organizationId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!contact) return { found: false };

  if (input.interactionType?.toLowerCase().includes("inbound")) {
    await registerInboundRinging({ ...input, contactId: contact.id, phone });
  }

  return {
    found: true,
    contact: threeCxCrmContactPayload(input.organizationId, contact),
  };
}

async function registerInboundRinging(input: {
  organizationId: string;
  routePointId: string;
  number: string;
  contactId?: string;
  phone?: string;
}) {
  const routePoint = await prisma.threeCxRoutePoint.findFirst({
    where: { id: input.routePointId, organizationId: input.organizationId },
  });
  if (!routePoint) return;

  const ctx = await resolveThreeCxCallContext({
    organizationId: input.organizationId,
    threeCxRoutePointId: input.routePointId,
    phone: input.phone ?? input.number,
    contactId: input.contactId ?? null,
  });

  const externalCallId = `inbound:${Date.now()}:${(input.phone ?? input.number).replace(/\D/g, "").slice(-12)}`;
  const caller = (ctx.dialPhone || input.number).slice(0, 32);
  const receiver = routePoint.routePointDn.slice(0, 32);

  const existing = await findProvisionalThreeCxCallLog(
    routePoint.id,
    ctx.contactId,
    caller,
  );
  if (existing && existing.status === "RINGING") return;

  const callLog = await prisma.threeCxCallLog.create({
    data: {
      organizationId: input.organizationId,
      threeCxRoutePointId: routePoint.id,
      externalCallId,
      direction: "INCOMING",
      caller,
      receiver,
      status: "RINGING",
      contactId: ctx.contactId,
      conversationId: ctx.conversationId,
      startedAt: new Date(),
    },
  });

  fireTelephonyCrmTriggers({
    organizationId: input.organizationId,
    provider: "3cx",
    callLogId: callLog.id,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    status: "RINGING",
    direction: "INCOMING",
    phone: caller,
    isIncomingRing: true,
  });

  const targetUserIds = await resolveIncomingCallTargetUserIds(
    {
      assignedUserId: routePoint.assignedUserId,
      externalConfig: routePoint.externalConfig,
    },
    input.organizationId,
  );

  broadcastToOrganization(input.organizationId, {
    type: "threecx.call.incoming",
    routePointId: routePoint.id,
    caller,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    targetUserIds,
  });
}

export async function journalThreeCxCall(input: {
  organizationId: string;
  routePointId: string;
  body: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const body = input.body;
  const number =
    (typeof body.Number === "string" ? body.Number : null) ??
    (typeof body.phone === "string" ? body.phone : null) ??
    (typeof body.Phone === "string" ? body.Phone : null) ??
    "";
  const directionRaw =
    (typeof body.Direction === "string" ? body.Direction : null) ??
    (typeof body.direction === "string" ? body.direction : null) ??
    "";
  const direction = directionRaw.toLowerCase().includes("out") ? "OUTGOING" : "INCOMING";
  const statusRaw =
    (typeof body.CallStatus === "string" ? body.CallStatus : null) ??
    (typeof body.status === "string" ? body.status : null) ??
    "ENDED";
  const status = normalizeThreeCxTerminalStatus(statusRaw);
  const durationSec =
    typeof body.Duration === "number"
      ? body.Duration
      : typeof body.durationSec === "number"
        ? body.durationSec
        : null;
  const externalCallId =
    (typeof body.CallID === "string" ? body.CallID : null) ??
    (typeof body.callId === "string" ? body.callId : null) ??
    `journal:${Date.now()}`;

  const routePoint = await prisma.threeCxRoutePoint.findFirst({
    where: { id: input.routePointId, organizationId: input.organizationId },
  });
  if (!routePoint) return { ok: false, message: "route_point_not_found" };

  const ctx = await resolveThreeCxCallContext({
    organizationId: input.organizationId,
    threeCxRoutePointId: input.routePointId,
    phone: number,
    contactId:
      typeof body.EntityId === "string"
        ? body.EntityId
        : typeof body.ContactID === "string"
          ? body.ContactID
          : null,
  });

  const caller = direction === "INCOMING" ? (ctx.dialPhone || number).slice(0, 32) : routePoint.routePointDn.slice(0, 32);
  const receiver =
    direction === "OUTGOING" ? (ctx.dialPhone || number).slice(0, 32) : routePoint.routePointDn.slice(0, 32);

  let row = await prisma.threeCxCallLog.findFirst({
    where: {
      threeCxRoutePointId: routePoint.id,
      OR: [
        { externalCallId },
        ...(ctx.contactId
          ? [{ contactId: ctx.contactId, externalCallId: { startsWith: "pending:" } }]
          : []),
        ...(ctx.contactId
          ? [{ contactId: ctx.contactId, externalCallId: { startsWith: "inbound:" } }]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  if (row) {
    row = await prisma.threeCxCallLog.update({
      where: { id: row.id },
      data: {
        externalCallId,
        status,
        durationSec,
        endedAt: new Date(),
        rawPayload: input.body as object,
        conversationId: ctx.conversationId ?? row.conversationId,
        contactId: ctx.contactId ?? row.contactId,
      },
    });
  } else {
    row = await prisma.threeCxCallLog.create({
      data: {
        organizationId: input.organizationId,
        threeCxRoutePointId: routePoint.id,
        externalCallId,
        direction,
        caller,
        receiver,
        status,
        durationSec,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        endedAt: new Date(),
        rawPayload: input.body as object,
      },
    });
  }

  if (ctx.contactId) {
    await appendTimelineEvent({
      organizationId: input.organizationId,
      subjectType: "CONTACT",
      subjectId: ctx.contactId,
      eventType: "threecx_call",
      channel: "3CX",
      payload: {
        title: `Chamada ${direction === "INCOMING" ? "recebida" : "realizada"}`,
        direction,
        status,
        durationSec,
      },
    });
  }

  if (ctx.conversationId) {
    const messageId = await upsertThreeCxTimelineMessage({
      conversationId: ctx.conversationId,
      externalCallId,
      clientCallId: row.clientCallId,
      direction,
      status,
      caller,
      receiver,
      durationSec,
    });
    if (messageId) {
      await prisma.threeCxCallLog.update({
        where: { id: row.id },
        data: { messageId },
      });
      broadcastConversationUpdated(input.organizationId, ctx.conversationId);
    }
  }

  await writeThreeCxIntegrationLog({
    organizationId: input.organizationId,
    threeCxRoutePointId: routePoint.id,
    level: "info",
    eventType: "crm_call_journal",
    message: `Call journal ${direction} ${status}`,
    payload: input.body,
  });

  fireTelephonyCrmTriggers({
    organizationId: input.organizationId,
    provider: "3cx",
    callLogId: row.id,
    contactId: ctx.contactId ?? row.contactId,
    conversationId: ctx.conversationId ?? row.conversationId,
    status,
    direction,
    phone: direction === "INCOMING" ? caller : receiver,
    isTerminal: true,
  });

  return { ok: true };
}

export async function loadRoutePointForCrm(
  organizationId: string,
  routePointId: string,
  request: { headers: Record<string, unknown> },
): Promise<
  | { ok: true; routePoint: Awaited<ReturnType<typeof prisma.threeCxRoutePoint.findFirst>> }
  | { ok: false; status: number; message: string }
> {
  const enabled = await isOrganizationFeatureEnabled(organizationId, "threecx_voice");
  if (!enabled) {
    return { ok: false, status: 403, message: "threecx_voice_disabled" };
  }

  const routePoint = await prisma.threeCxRoutePoint.findFirst({
    where: { id: routePointId, organizationId },
  });
  if (!routePoint) {
    return { ok: false, status: 404, message: "route_point_not_found" };
  }

  const key = crmAuthHeader(request);
  if (!verifyThreeCxCrmApiKey(routePoint, key)) {
    return { ok: false, status: 401, message: "invalid_crm_api_key" };
  }

  return { ok: true, routePoint };
}

/** Regista rotas públicas CRM (3CX → OpenConduit). */
export async function threeCxCrmRoutes(app: FastifyInstance): Promise<void> {
  const base = "/integrations/3cx/crm/:organizationId/:routePointId";

  app.get(`${base}/lookup/number`, async (request, reply) => {
    const { organizationId, routePointId } = request.params as {
      organizationId: string;
      routePointId: string;
    };
    const loaded = await loadRoutePointForCrm(organizationId, routePointId, request);
    if (!loaded.ok) {
      return reply.status(loaded.status).send({ error: loaded.message });
    }

    const q = request.query as { number?: string; Number?: string; InteractionType?: string };
    const number = q.number ?? q.Number ?? "";
    const result = await lookupContactByNumber({
      organizationId,
      routePointId,
      number,
      interactionType: q.InteractionType,
    });

    if (!result.found || !result.contact) {
      return reply.status(404).send({ error: "contact_not_found" });
    }
    return result.contact;
  });

  app.get(`${base}/lookup/email`, async (request, reply) => {
    const { organizationId, routePointId } = request.params as {
      organizationId: string;
      routePointId: string;
    };
    const loaded = await loadRoutePointForCrm(organizationId, routePointId, request);
    if (!loaded.ok) {
      return reply.status(loaded.status).send({ error: loaded.message });
    }

    const q = request.query as { email?: string; Email?: string };
    const email = (q.email ?? q.Email ?? "").trim().toLowerCase();
    if (!email) return reply.status(400).send({ error: "email_required" });

    const contact = await prisma.contact.findFirst({
      where: { organizationId, email: { equals: email, mode: "insensitive" } },
      select: { id: true, name: true, phone: true, email: true },
    });
    if (!contact) return reply.status(404).send({ error: "contact_not_found" });

    return threeCxCrmContactPayload(organizationId, contact);
  });

  app.get(`${base}/search`, async (request, reply) => {
    const { organizationId } = request.params as { organizationId: string; routePointId: string };
    const loaded = await loadRoutePointForCrm(
      organizationId,
      (request.params as { routePointId: string }).routePointId,
      request,
    );
    if (!loaded.ok) {
      return reply.status(loaded.status).send({ error: loaded.message });
    }

    const q = request.query as { q?: string; SearchText?: string };
    const term = (q.q ?? q.SearchText ?? "").trim();
    if (term.length < 2) return { contacts: [] };

    const contacts = await prisma.contact.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { phone: { contains: term.replace(/\D/g, "") } },
          { email: { contains: term, mode: "insensitive" } },
        ],
      },
      take: 20,
      select: { id: true, name: true, phone: true, email: true },
    });

    return {
      contacts: contacts.map((c) => threeCxCrmContactPayload(organizationId, c)),
    };
  });

  app.post(`${base}/journal/call`, async (request, reply) => {
    const { organizationId, routePointId } = request.params as {
      organizationId: string;
      routePointId: string;
    };
    const loaded = await loadRoutePointForCrm(organizationId, routePointId, request);
    if (!loaded.ok) {
      return reply.status(loaded.status).send({ error: loaded.message });
    }

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const result = await journalThreeCxCall({ organizationId, routePointId, body });
    if (!result.ok) {
      return reply.status(400).send({ error: result.message });
    }
    return { ok: true };
  });
}
