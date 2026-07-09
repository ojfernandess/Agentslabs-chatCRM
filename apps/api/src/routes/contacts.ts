import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { normalizePhoneE164, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, formatMessageBodyForPreview } from "@openconduit/shared";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { ensurePipelineStageForLeadType } from "../lib/pipelineLeadTypeSync.js";
import { syncDealsForContactPipelineStage } from "../lib/dealStageSync.js";
import { fireBroadcastEventTriggers } from "../lib/broadcastEventHooks.js";
import { fireCrmFlowTriggers } from "../lib/crmFlowHooks.js";
import {
  resolveContactProfilePictureBuffer,
  syncContactProfilePicture,
  syncContactProfilePicturesBatch,
} from "../lib/contactProfilePictureResolve.js";
import {
  buildContactsCsv,
  buildContactsVcf,
  buildContactsXlsx,
  fetchContactsForExport,
  importContactRows,
  parseContactImportFile,
} from "../lib/contactImportExport.js";
import { contactHasEmailFilter } from "../lib/conversationUserEmailState.js";

const createContactSchema = z.object({
  phone: z.string().min(7).max(16),
  name: z.string().min(1).max(255),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().uuid()).optional(),
});

const updateContactSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().min(7).max(16).optional(),
  notes: z.string().max(5000).optional(),
  email: z.string().max(255).nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  /** Nome da empresa: vazio ou null desassocia a conta; texto cria ou reutiliza Account por nome. */
  company: z.string().max(255).nullable().optional(),
  /** Gravado em account.metadata (chaves document / city). */
  document: z.string().max(120).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  /** Site da empresa (Account.website). */
  website: z.string().max(512).nullable().optional(),
  lifecycleStage: z.string().max(64).nullable().optional(),
  pipelineStageId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  optedIn: z.boolean().optional(),
});

async function findOrCreateAccountByName(
  organizationId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  const existing = await prisma.account.findFirst({
    where: { organizationId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return existing.id;
  const created = await prisma.account.create({
    data: { organizationId, name: trimmed },
  });
  return created.id;
}

function mergeAccountMetadataPatch(
  current: unknown,
  document: string | null | undefined,
  city: string | null | undefined,
): Prisma.InputJsonValue {
  const base: Record<string, unknown> =
    current != null && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};

  if (document !== undefined) {
    if (document === null || document.trim() === "") {
      delete base.document;
      delete base.documento;
      delete base.cpf;
      delete base.cnpj;
      delete base.taxId;
    } else {
      base.document = document.trim();
    }
  }
  if (city !== undefined) {
    if (city === null || city.trim() === "") {
      delete base.city;
      delete base.cidade;
      delete base.municipio;
    } else {
      base.city = city.trim();
    }
  }
  return base as Prisma.InputJsonValue;
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().optional(),
  tag: z.string().uuid().optional(),
  stage: z.string().uuid().optional(),
  assignee: z.string().uuid().optional(),
  hasEmail: z.enum(["1", "true", "0", "false"]).optional(),
});

const syncAvatarsSchema = z.object({
  contactIds: z.array(z.string().uuid()).max(40),
});

type ContactListRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  profilePictureUrl: string | null;
  optedIn: boolean;
  lifecycleStage: string | null;
  updatedAt: Date;
  tags: { tag: { id: string; name: string; color: string } }[];
  pipelineStage: {
    id: string;
    name: string;
    color: string;
    order: number;
    probabilityPct: number;
    leadTypeId: string | null;
  } | null;
  assignedTo: { id: string; name: string } | null;
  account: { id: string; name: string; metadata: unknown } | null;
  lastMessage: {
    preview: string;
    createdAt: Date;
    direction: string;
    type: string;
  } | null;
  primaryChannel: string | null;
  inboxName: string | null;
  openDealsTotalCents: number;
  openDealsCurrency: string;
  openDealCount: number;
  engagementScore: number;
  recentlyActive: boolean;
};

function previewFromMessage(body: string | null, type: string): string {
  const formatted = formatMessageBodyForPreview(body, { messageType: type });
  if (formatted) return formatted;
  if (type === "TEXT") return "";
  const short: Record<string, string> = {
    IMAGE: "📷 Imagem",
    AUDIO: "🎤 Áudio",
    VIDEO: "🎬 Vídeo",
    DOCUMENT: "📎 Documento",
    TEMPLATE: "📋 Template",
  };
  return short[type] ?? "…";
}

function engagementScoreFromListContact(c: {
  optedIn: boolean;
  tags: unknown[];
  pipelineStage: { probabilityPct: number } | null;
  dealsPrimary: unknown[];
  conversations: {
    updatedAt: Date;
    messages: { createdAt: Date; body: string | null; type: string }[];
  }[];
}): number {
  let s = 28;
  const lastMsg = c.conversations[0]?.messages[0];
  if (lastMsg) {
    const days = (Date.now() - lastMsg.createdAt.getTime()) / 86_400_000;
    if (days < 3) s += 28;
    else if (days < 14) s += 18;
    else if (days < 60) s += 8;
  }
  if (c.optedIn) s += 12;
  const prob = c.pipelineStage?.probabilityPct ?? 0;
  s += Math.min(22, Math.round(prob * 0.22));
  if (c.dealsPrimary.length > 0) {
    s += Math.min(18, 6 * c.dealsPrimary.length);
  }
  s += Math.min(14, c.tags.length * 2);
  return Math.min(100, s);
}

function recentlyActiveFromListContact(c: {
  updatedAt: Date;
  conversations: {
    updatedAt: Date;
    messages: { createdAt: Date }[];
  }[];
}): boolean {
  const lastMsg = c.conversations[0]?.messages[0];
  const t = lastMsg
    ? Math.max(lastMsg.createdAt.getTime(), c.updatedAt.getTime())
    : c.updatedAt.getTime();
  return Date.now() - t < 8 * 60 * 1000;
}

function mapContactListRow(
  c: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    profilePictureUrl: string | null;
    optedIn: boolean;
    lifecycleStage: string | null;
    updatedAt: Date;
    tags: { tag: { id: string; name: string; color: string } }[];
    pipelineStage: {
      id: string;
      name: string;
      color: string;
      order: number;
      probabilityPct: number;
      leadTypeId: string | null;
    } | null;
    assignedTo: { id: string; name: string } | null;
    account: { id: string; name: string; metadata: unknown } | null;
    dealsPrimary: { amountCents: number; currency: string }[];
    conversations: {
      updatedAt: Date;
      inbox: { channelType: string; name: string } | null;
      messages: { createdAt: Date; body: string | null; direction: string; type: string }[];
    }[];
  },
): ContactListRow {
  const conv = c.conversations[0];
  const lastMsg = conv?.messages[0];
  const dealSum = c.dealsPrimary.reduce((acc, d) => acc + d.amountCents, 0);
  const currency = c.dealsPrimary[0]?.currency ?? "BRL";
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    profilePictureUrl: c.profilePictureUrl,
    optedIn: c.optedIn,
    lifecycleStage: c.lifecycleStage,
    updatedAt: c.updatedAt,
    tags: c.tags,
    pipelineStage: c.pipelineStage,
    assignedTo: c.assignedTo,
    account: c.account,
    lastMessage: lastMsg
      ? {
          preview: previewFromMessage(lastMsg.body, lastMsg.type),
          createdAt: lastMsg.createdAt,
          direction: lastMsg.direction,
          type: lastMsg.type,
        }
      : null,
    primaryChannel: conv?.inbox?.channelType ?? null,
    inboxName: conv?.inbox?.name ?? null,
    openDealsTotalCents: dealSum,
    openDealsCurrency: currency,
    openDealCount: c.dealsPrimary.length,
    engagementScore: engagementScoreFromListContact(c),
    recentlyActive: recentlyActiveFromListContact(c),
  };
}

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = querySchema.parse(request.query);
    const where: Record<string, unknown> = { organizationId };

    if (query.hasEmail === "1" || query.hasEmail === "true") {
      const emailFilter = contactHasEmailFilter();
      where.AND = where.AND ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), emailFilter] : [emailFilter];
    }

    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { email: { contains: q, mode: "insensitive" } },
        { account: { name: { contains: q, mode: "insensitive" } } },
      ];
    }
    if (query.tag) {
      where.tags = { some: { tagId: query.tag } };
    }
    if (query.stage) {
      where.pipelineStageId = query.stage;
    }
    if (query.assignee) {
      where.assignedToId = query.assignee;
    }

    const [raw, total, withOpenDeals] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          pipelineStage: true,
          assignedTo: { select: { id: true, name: true } },
          account: { select: { id: true, name: true, metadata: true } },
          dealsPrimary: {
            where: { status: "OPEN" },
            select: { amountCents: true, currency: true },
          },
          conversations: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            include: {
              inbox: { select: { channelType: true, name: true } },
              messages: {
                where: { isPrivate: false },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { body: true, direction: true, createdAt: true, type: true },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.contact.count({ where }),
      prisma.contact.count({
        where: {
          ...where,
          dealsPrimary: { some: { status: "OPEN" } },
        },
      }),
    ]);

    const data: ContactListRow[] = raw.map(mapContactListRow);
    const engagementSum = data.reduce((acc, row) => acc + row.engagementScore, 0);
    const avgEngagement = data.length > 0 ? Math.round(engagementSum / data.length) : 0;
    return {
      data,
      total,
      page: query.page,
      pageSize: query.pageSize,
      stats: { withOpenDeals, avgEngagementOnPage: avgEngagement },
    };
  });

  app.post("/sync-avatars", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const body = syncAvatarsSchema.parse(request.body ?? {});
    return syncContactProfilePicturesBatch({
      organizationId,
      contactIds: body.contactIds,
    });
  });

  app.get("/export", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const formatRaw = String((request.query as { format?: string }).format ?? "csv").toLowerCase();
    if (formatRaw !== "csv" && formatRaw !== "xlsx" && formatRaw !== "vcf") {
      return reply.status(400).send({
        error: "Bad Request",
        message: "format must be csv, xlsx, or vcf",
        statusCode: 400,
      });
    }

    const search = typeof (request.query as { search?: string }).search === "string"
      ? (request.query as { search?: string }).search
      : undefined;

    const rows = await fetchContactsForExport({ organizationId, search });
    const stamp = new Date().toISOString().slice(0, 10);

    if (formatRaw === "csv") {
      const buf = buildContactsCsv(rows);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="contacts-${stamp}.csv"`)
        .send(buf);
    }
    if (formatRaw === "xlsx") {
      const buf = buildContactsXlsx(rows);
      return reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="contacts-${stamp}.xlsx"`)
        .send(buf);
    }

    const buf = buildContactsVcf(rows);
    return reply
      .header("Content-Type", "text/vcard; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="contacts-${stamp}.vcf"`)
      .send(buf);
  });

  app.post("/import", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    let fileBuf: Buffer | null = null;
    let fileName = "upload";
    let fileMime = "";
    const fields: Record<string, string> = {};

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          fileBuf = await part.toBuffer();
          fileName = part.filename || "upload";
          fileMime = part.mimetype || "";
        } else {
          fields[part.fieldname] = String(part.value ?? "");
        }
      }
    } catch (err) {
      request.log.warn({ err }, "contacts import multipart parse failed");
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid multipart body",
        statusCode: 400,
      });
    }

    if (!fileBuf?.length) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Expected one file field in multipart form",
        statusCode: 400,
      });
    }

    let parsed: ReturnType<typeof parseContactImportFile>;
    try {
      parsed = parseContactImportFile(fileBuf, fileName, fileMime);
    } catch (e) {
      const code = e instanceof Error ? e.message : "parse_failed";
      const status = code === "unsupported_format" ? 415 : 400;
      return reply.status(status).send({
        error: status === 415 ? "Unsupported Media Type" : "Bad Request",
        code,
        message:
          code === "unsupported_format"
            ? "Use CSV, XLSX, or VCF (.vcf)"
            : code === "empty_file"
              ? "No contacts found in file"
              : "Could not parse file",
        statusCode: status,
      });
    }

    const updateExisting = fields.updateExisting !== "false" && fields.updateExisting !== "0";

    const result = await importContactRows(app, organizationId, parsed.rows, {
      updateExisting,
      createdById: request.user.id,
    });

    return reply.status(200).send({
      format: parsed.format,
      ...result,
    });
  });

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    "/:id/profile-picture",
    async (request, reply) => {
      const organizationId = await resolveTenantOrganizationId(request, reply);
      if (!organizationId) return;

      const contact = await prisma.contact.findFirst({
        where: { id: request.params.id, organizationId },
        select: { id: true, phone: true, profilePictureUrl: true, isGroupChat: true },
      });
      if (!contact || contact.isGroupChat) {
        return reply.status(404).send({ error: "Not Found", message: "No profile picture", statusCode: 404 });
      }

      const refresh =
        request.query?.refresh === "1" || request.query?.refresh === "true";

      let buf = refresh
        ? null
        : await resolveContactProfilePictureBuffer({
            organizationId,
            contactId: contact.id,
            phone: contact.phone,
            profilePictureUrl: contact.profilePictureUrl,
          });

      if (!buf && refresh) {
        buf = await syncContactProfilePicture({
          organizationId,
          contactId: contact.id,
          phone: contact.phone,
          profilePictureUrl: contact.profilePictureUrl,
          force: true,
        });
      }

      if (!buf) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Profile picture unavailable or expired",
          statusCode: 404,
        });
      }

      reply.header("Cache-Control", "private, max-age=3600");
      return reply.type("image/jpeg").send(buf);
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const contact = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        tags: { include: { tag: true } },
        pipelineStage: true,
        assignedTo: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, website: true, industry: true, metadata: true } },
        conversations: {
          orderBy: { updatedAt: "desc" },
          take: 30,
          include: { inbox: { select: { channelType: true, name: true } } },
        },
      },
    });

    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    return contact;
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = createContactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const phone = normalizePhoneE164(parsed.data.phone);
    if (!phone) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid phone number format", statusCode: 400 });
    }

    const existing = await prisma.contact.findFirst({ where: { organizationId, phone } });
    if (existing) {
      return reply
        .status(409)
        .send({ error: "Conflict", message: "Contact with this phone number already exists", statusCode: 409 });
    }

    const contact = await prisma.contact.create({
      data: {
        organizationId,
        phone,
        name: parsed.data.name,
        notes: parsed.data.notes,
        createdById: request.user.id,
        tags: parsed.data.tags
          ? { create: parsed.data.tags.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: { tags: { include: { tag: true } } },
    });

    fireBroadcastEventTriggers(app, organizationId, "NEW_LEAD", { contactId: contact.id });

    return reply.status(201).send(contact);
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateContactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const current = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!current) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    if (parsed.data.lifecycleStage !== undefined) data.lifecycleStage = parsed.data.lifecycleStage;
    if (parsed.data.pipelineStageId !== undefined) data.pipelineStageId = parsed.data.pipelineStageId;
    if (parsed.data.assignedToId !== undefined) data.assignedToId = parsed.data.assignedToId;
    if (parsed.data.optedIn !== undefined) {
      data.optedIn = parsed.data.optedIn;
      if (parsed.data.optedIn) data.optedInAt = new Date();
    }

    const wantsCompany = parsed.data.company !== undefined;
    const wantsWebsite = parsed.data.website !== undefined;
    const wantsMeta =
      parsed.data.document !== undefined || parsed.data.city !== undefined;

    if (wantsCompany) {
      const c = parsed.data.company;
      if (c === null || (typeof c === "string" && c.trim() === "")) {
        data.accountId = null;
      } else if (typeof c === "string") {
        data.accountId = await findOrCreateAccountByName(organizationId, c);
      }
    } else if (parsed.data.accountId !== undefined) {
      data.accountId = parsed.data.accountId;
    }

    if ((wantsMeta || wantsWebsite) && !wantsCompany) {
      const doc = parsed.data.document;
      const city = parsed.data.city;
      const web = parsed.data.website;
      const anyNonEmpty =
        (doc !== undefined && doc !== null && String(doc).trim() !== "") ||
        (city !== undefined && city !== null && String(city).trim() !== "") ||
        (web !== undefined && web !== null && String(web).trim() !== "");
      if (!current.accountId && anyNonEmpty) {
        const acc = await prisma.account.create({
          data: { organizationId, name: current.name },
        });
        data.accountId = acc.id;
      }
    }

    if (parsed.data.phone !== undefined) {
      const normalized = normalizePhoneE164(parsed.data.phone);
      if (!normalized) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid phone number format", statusCode: 400 });
      }
      if (normalized !== current.phone) {
        const conflict = await prisma.contact.findFirst({
          where: { organizationId, phone: normalized, NOT: { id: current.id } },
        });
        if (conflict) {
          return reply.status(409).send({
            error: "Conflict",
            message: "Contact with this phone number already exists",
            statusCode: 409,
          });
        }
      }
      data.phone = normalized;
    }

    if (parsed.data.pipelineStageId) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: parsed.data.pipelineStageId, pipeline: { organizationId, isDefault: true } },
      });
      if (!stage) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid pipeline stage", statusCode: 400 });
      }
    }

    const accountIdToValidate =
      typeof data.accountId === "string" ? data.accountId : parsed.data.accountId;
    if (accountIdToValidate) {
      const acc = await prisma.account.findFirst({
        where: { id: accountIdToValidate, organizationId },
      });
      if (!acc) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid account", statusCode: 400 });
      }
    }

    const contactDetailInclude = {
      tags: { include: { tag: true } },
      pipelineStage: true,
      assignedTo: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, website: true, industry: true, metadata: true } },
      conversations: {
        orderBy: { updatedAt: "desc" as const },
        take: 30,
        include: { inbox: { select: { channelType: true, name: true } } },
      },
    } satisfies Prisma.ContactInclude;

    try {
      await prisma.contact.update({
        where: { id: request.params.id },
        data,
      });
      if (parsed.data.pipelineStageId !== undefined) {
        const row = await prisma.contact.findFirst({
          where: { id: request.params.id, organizationId },
          select: { pipelineStageId: true },
        });
        if (row?.pipelineStageId) {
          await syncDealsForContactPipelineStage(
            prisma,
            organizationId,
            request.params.id,
            row.pipelineStageId,
          );
        }
      }

      if (wantsMeta) {
        const row = await prisma.contact.findFirst({
          where: { id: request.params.id, organizationId },
          select: { accountId: true },
        });
        if (row?.accountId) {
          const accRow = await prisma.account.findFirst({
            where: { id: row.accountId, organizationId },
          });
          if (accRow) {
            const nextMeta = mergeAccountMetadataPatch(
              accRow.metadata,
              parsed.data.document,
              parsed.data.city,
            );
            await prisma.account.update({
              where: { id: accRow.id },
              data: { metadata: nextMeta },
            });
          }
        }
      }

      if (wantsWebsite) {
        const row = await prisma.contact.findFirst({
          where: { id: request.params.id, organizationId },
          select: { accountId: true },
        });
        if (row?.accountId) {
          const web =
            parsed.data.website === null || parsed.data.website === undefined
              ? null
              : parsed.data.website.trim().slice(0, 512) || null;
          await prisma.account.update({
            where: { id: row.accountId },
            data: { website: web },
          });
        }
      }

      const contact = await prisma.contact.findFirst({
        where: { id: request.params.id, organizationId },
        include: contactDetailInclude,
      });
      if (!contact) {
        return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
      }

      if (parsed.data.pipelineStageId !== undefined && contact.pipelineStageId) {
        fireBroadcastEventTriggers(app, organizationId, "DEAL_STAGE_CHANGED", {
          contactId: contact.id,
          pipelineStageId: contact.pipelineStageId,
        });
      } else if (Object.keys(data).length > 0) {
        fireCrmFlowTriggers(
          organizationId,
          "lead_updated",
          { contactId: contact.id, pipelineStageId: contact.pipelineStageId },
          app.log,
        );
      }

      return contact;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.contact.deleteMany({
      where: { id: request.params.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/:id/messages", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const contact = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
      include: {
        conversations: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
              include: {
                actorUser: { select: { id: true, name: true, displayName: true } },
                conversation: {
                  select: { id: true, inbox: { select: { channelType: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const messages = contact.conversations.flatMap((c) => c.messages);
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return messages;
  });

  app.post<{ Params: { id: string } }>("/:id/tags", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({ tagIds: z.array(z.string().uuid()) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const contactExists = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!contactExists) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    await prisma.contactTag.createMany({
      data: parsed.data.tagIds.map((tagId) => ({
        contactId: request.params.id,
        tagId,
      })),
      skipDuplicates: true,
    });

    const unknownTag = await prisma.tag.findFirst({
      where: { organizationId, name: "Desconhecido" },
    });
    if (unknownTag && !parsed.data.tagIds.includes(unknownTag.id)) {
      await prisma.contactTag.deleteMany({
        where: { contactId: request.params.id, tagId: unknownTag.id },
      });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
      include: { tags: { include: { tag: true } } },
    });

    for (const tagId of parsed.data.tagIds) {
      fireBroadcastEventTriggers(app, organizationId, "TAG_ADDED", {
        contactId: request.params.id,
        tagId,
      });
    }

    return contact;
  });

  app.delete<{ Params: { id: string; tagId: string } }>("/:id/tags/:tagId", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const contactExists = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!contactExists) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    try {
      await prisma.contactTag.delete({
        where: {
          contactId_tagId: {
            contactId: request.params.id,
            tagId: request.params.tagId,
          },
        },
      });
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Tag assignment not found", statusCode: 404 });
    }
  });

  app.put<{ Params: { id: string } }>("/:id/stage", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const schema = z.object({
      stageId: z.string().uuid().nullable().optional(),
      leadTypeId: z.string().uuid().nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const hasLead = parsed.data.leadTypeId !== undefined;
    const hasStage = parsed.data.stageId !== undefined;
    if (hasLead === hasStage) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Provide exactly one of leadTypeId or stageId (legacy pipeline stage UUID).",
        statusCode: 400,
      });
    }

    const current = await prisma.contact.findFirst({
      where: { id: request.params.id, organizationId },
    });
    if (!current) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    let nextPipelineStageId: string | null = null;
    if (hasLead) {
      if (parsed.data.leadTypeId === null) {
        nextPipelineStageId = null;
      } else {
        const ltId = parsed.data.leadTypeId;
        if (ltId === undefined) {
          return reply.status(400).send({ error: "Bad Request", message: "Invalid leadTypeId", statusCode: 400 });
        }
        const stage = await ensurePipelineStageForLeadType(prisma, organizationId, ltId);
        nextPipelineStageId = stage.id;
      }
    } else if (parsed.data.stageId === null) {
      nextPipelineStageId = null;
    } else {
      const stage = await prisma.pipelineStage.findFirst({
        where: { id: parsed.data.stageId!, pipeline: { organizationId, isDefault: true } },
      });
      if (!stage) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid pipeline stage", statusCode: 400 });
      }
      nextPipelineStageId = stage.id;
    }

    try {
      const contact = await prisma.contact.update({
        where: { id: request.params.id },
        data: { pipelineStageId: nextPipelineStageId },
        include: { pipelineStage: true },
      });
      if (contact.pipelineStageId) {
        await syncDealsForContactPipelineStage(
          prisma,
          organizationId,
          contact.id,
          contact.pipelineStageId,
        );
        fireBroadcastEventTriggers(app, organizationId, "DEAL_STAGE_CHANGED", {
          contactId: contact.id,
          pipelineStageId: contact.pipelineStageId,
        });
      }
      return contact;
    } catch {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }
  });
}
