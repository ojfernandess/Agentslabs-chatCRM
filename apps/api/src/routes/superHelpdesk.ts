import type { FastifyInstance } from "fastify";
import { requireSuperAdmin } from "../middleware/auth.js";
import { clientIp, recordAuditLog } from "../lib/audit.js";
import {
  addHelpdeskMessage,
  fetchHelpdeskRequestById,
  listAllHelpdeskRequests,
  parseHelpdeskMultipart,
  serializeHelpdeskRequest,
  updateHelpdeskRequest,
} from "../lib/orgHelpdeskService.js";
import { superHelpdeskPatchSchema } from "./helpdesk.js";

async function safeAudit(
  request: { user: { id: string } },
  entry: Parameters<typeof recordAuditLog>[0],
) {
  try {
    await recordAuditLog(entry);
  } catch {
    /* audit best-effort */
  }
}

export async function superHelpdeskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get<{ Querystring: { status?: string; organizationId?: string } }>(
    "/helpdesk/requests",
    async (request) => {
      const status = request.query.status?.trim().toUpperCase();
      const organizationId = request.query.organizationId?.trim();
      return listAllHelpdeskRequests({
        status: status || undefined,
        organizationId: organizationId || undefined,
      });
    },
  );

  app.get<{ Params: { id: string } }>("/helpdesk/requests/:id", async (request, reply) => {
    const row = await fetchHelpdeskRequestById(request.params.id);
    if (!row) {
      return reply.status(404).send({ error: "Not Found", message: "Request not found", statusCode: 404 });
    }
    return serializeHelpdeskRequest(row);
  });

  app.patch<{ Params: { id: string } }>("/helpdesk/requests/:id", async (request, reply) => {
    const parsed = superHelpdeskPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const updated = await updateHelpdeskRequest({
      requestId: request.params.id,
      actorUserId: request.user.id,
      status: parsed.data.status,
      progressNote: parsed.data.progressNote,
      progressPercent: parsed.data.progressPercent,
      accept: parsed.data.accept,
    });

    if (!updated) {
      return reply.status(404).send({ error: "Not Found", message: "Request not found", statusCode: 404 });
    }

    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: updated.organizationId,
      action: "super.helpdesk.update",
      resourceType: "org_helpdesk_request",
      resourceId: updated.id,
      metadata: parsed.data,
      ip: clientIp(request),
    });

    return updated;
  });

  app.post<{ Params: { id: string } }>("/helpdesk/requests/:id/messages", async (request, reply) => {
    const existing = await fetchHelpdeskRequestById(request.params.id);
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Request not found", statusCode: 404 });
    }

    let parsed: Awaited<ReturnType<typeof parseHelpdeskMultipart>>;
    try {
      parsed = await parseHelpdeskMultipart(request.parts());
    } catch (err) {
      request.log.warn({ err }, "super helpdesk message multipart parse failed");
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid multipart body",
        statusCode: 400,
      });
    }

    const body = (parsed.fields.body ?? "").trim();
    if (!body && parsed.files.length === 0) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Message body or attachment required",
        statusCode: 400,
      });
    }

    const updated = await addHelpdeskMessage({
      requestId: request.params.id,
      authorUserId: request.user.id,
      body: body || "(anexo)",
      isStaffReply: true,
      files: parsed.files,
    });

    if (!updated) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Cannot reply to this request",
        statusCode: 400,
      });
    }

    await safeAudit(request, {
      actorUserId: request.user.id,
      organizationId: updated.organizationId,
      action: "super.helpdesk.reply",
      resourceType: "org_helpdesk_request",
      resourceId: updated.id,
      metadata: { hasAttachments: parsed.files.length > 0 },
      ip: clientIp(request),
    });

    return updated;
  });
}
