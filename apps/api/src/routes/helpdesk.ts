import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import {
  addHelpdeskMessage,
  createHelpdeskRequest,
  fetchHelpdeskRequestById,
  isHelpdeskCategory,
  listOrgHelpdeskRequests,
  parseHelpdeskMultipart,
  serializeHelpdeskRequest,
} from "../lib/orgHelpdeskService.js";

export async function helpdeskRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  await app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.get("/requests", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;
      return listOrgHelpdeskRequests(organizationId);
    });

    admin.get<{ Params: { id: string } }>("/requests/:id", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const row = await fetchHelpdeskRequestById(request.params.id);
      if (!row || row.organizationId !== organizationId) {
        return reply.status(404).send({ error: "Not Found", message: "Request not found", statusCode: 404 });
      }
      return serializeHelpdeskRequest(row);
    });

    admin.post("/requests", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      let parsed: Awaited<ReturnType<typeof parseHelpdeskMultipart>>;
      try {
        parsed = await parseHelpdeskMultipart(request.parts());
      } catch (err) {
        request.log.warn({ err }, "helpdesk create multipart parse failed");
        return reply.status(400).send({
          error: "Bad Request",
          message: "Invalid multipart body",
          statusCode: 400,
        });
      }

      const category = (parsed.fields.category ?? "").trim().toUpperCase();
      const subject = (parsed.fields.subject ?? "").trim();
      const description = (parsed.fields.description ?? "").trim();

      if (!isHelpdeskCategory(category)) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Invalid category",
          statusCode: 400,
        });
      }
      if (!subject || !description) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Subject and description are required",
          statusCode: 400,
        });
      }

      const created = await createHelpdeskRequest({
        organizationId,
        createdById: request.user.id,
        category,
        subject,
        description,
        files: parsed.files,
      });

      return reply.status(201).send(created);
    });

    admin.post<{ Params: { id: string } }>("/requests/:id/messages", async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const existing = await fetchHelpdeskRequestById(request.params.id);
      if (!existing || existing.organizationId !== organizationId) {
        return reply.status(404).send({ error: "Not Found", message: "Request not found", statusCode: 404 });
      }

      let parsed: Awaited<ReturnType<typeof parseHelpdeskMultipart>>;
      try {
        parsed = await parseHelpdeskMultipart(request.parts());
      } catch (err) {
        request.log.warn({ err }, "helpdesk message multipart parse failed");
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
        isStaffReply: false,
        files: parsed.files,
      });

      if (!updated) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Cannot reply to this request",
          statusCode: 400,
        });
      }

      return updated;
    });
  });
}

export const superHelpdeskPatchSchema = z.object({
  status: z.enum(["OPEN", "ACCEPTED", "IN_PROGRESS", "WAITING_ORG", "RESOLVED", "CLOSED"]).optional(),
  progressNote: z.union([z.string().max(5000), z.null()]).optional(),
  progressPercent: z.union([z.number().int().min(0).max(100), z.null()]).optional(),
  accept: z.boolean().optional(),
});
