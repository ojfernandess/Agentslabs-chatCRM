import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";
import { resolveTenantOrganizationId } from "../lib/tenantContext.js";
import { callOpenAiCompatibleChat } from "../lib/promptModulePreviewLlm.js";
import { getAssistOpenAiCredentialsForOrganization, assistOpenAiModel } from "../lib/agentAssistLlm.js";

const reminderSchema = z.object({
  contactId: z.string().uuid(),
  note: z.string().min(1).max(2000),
  dueAt: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Invalid dueAt" }),
  status: z.enum(["TODO", "DOING", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

const updateReminderSchema = z.object({
  note: z.string().min(1).max(2000).optional(),
  dueAt: z
    .string()
    .min(1)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Invalid dueAt" })
    .optional(),
  completed: z.boolean().optional(),
  status: z.enum(["TODO", "DOING", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

const plannerSchema = z.object({
  contactId: z.string().uuid(),
  goal: z.string().min(3).max(400),
  language: z.string().max(12).optional(),
});

function aiScoreForDue(dueAt: Date): number {
  const now = Date.now();
  const dt = dueAt.getTime() - now;
  const hours = dt / (1000 * 60 * 60);
  if (hours <= -24) return 92;
  if (hours < 0) return 86;
  if (hours <= 6) return 78;
  if (hours <= 24) return 66;
  if (hours <= 72) return 52;
  return 38;
}

export async function reminderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/notification-due", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = request.query as Record<string, string>;
    const fromRaw = query.from;
    const toRaw = query.to;

    const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 60_000);
    const to = toRaw ? new Date(toRaw) : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: "Bad Request", message: "Invalid from/to", statusCode: 400 });
    }

    if (to.getTime() - from.getTime() > 15 * 60_000) {
      return reply
        .status(400)
        .send({ error: "Bad Request", message: "Window too large", statusCode: 400 });
    }

    return prisma.reminder.findMany({
      where: {
        organizationId,
        userId: request.user.id,
        completed: false,
        status: { in: ["TODO", "DOING"] },
        dueAt: { gte: from, lte: to },
      },
      include: { contact: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueAt: "asc" },
      take: 50,
    });
  });

  /** Lembretes do dia (ou atrasados) ainda não concluídos — visíveis até marcar como feito. */
  app.get("/actionable", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const now = new Date();
    const startOfTomorrow = new Date(now);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    startOfTomorrow.setHours(0, 0, 0, 0);

    return prisma.reminder.findMany({
      where: {
        organizationId,
        userId: request.user.id,
        completed: false,
        status: { in: ["TODO", "DOING"] },
        dueAt: { lt: startOfTomorrow },
      },
      include: { contact: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueAt: "asc" },
      take: 50,
    });
  });

  app.get("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const query = request.query as Record<string, string>;
    const filter = query.filter;
    const search = query.search?.trim();
    const status = query.status?.trim();
    const priority = query.priority?.trim();
    const where: Record<string, unknown> = {
      userId: request.user.id,
      organizationId,
    };

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    if (filter === "today") {
      where.dueAt = { gte: startOfToday, lte: endOfDay };
      where.completed = false;
    } else if (filter === "overdue") {
      where.dueAt = { lt: now };
      where.completed = false;
    } else if (filter === "upcoming") {
      where.dueAt = { gt: endOfDay };
      where.completed = false;
    }

    if (status === "TODO" || status === "DOING" || status === "DONE") {
      where.status = status;
    }
    if (priority === "LOW" || priority === "MEDIUM" || priority === "HIGH" || priority === "URGENT") {
      where.priority = priority;
    }

    if (search) {
      where.OR = [
        { note: { contains: search, mode: "insensitive" } },
        { contact: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    return prisma.reminder.findMany({
      where,
      include: { contact: { select: { id: true, name: true, phone: true } } },
      orderBy: { dueAt: "asc" },
    });
  });

  app.post("/", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = reminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId },
    });
    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const reminder = await prisma.reminder.create({
      data: {
        organizationId,
        contactId: parsed.data.contactId,
        userId: request.user.id,
        note: parsed.data.note,
        dueAt: new Date(parsed.data.dueAt),
        status: parsed.data.status ?? "TODO",
        priority: parsed.data.priority ?? "MEDIUM",
        completed: (parsed.data.status ?? "TODO") === "DONE",
      },
      include: { contact: { select: { id: true, name: true, phone: true } } },
    });

    return reply.status(201).send(reminder);
  });

  app.post("/planner", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = plannerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId },
      select: { id: true },
    });
    if (!contact) {
      return reply.status(404).send({ error: "Not Found", message: "Contact not found", statusCode: 404 });
    }

    const goal = parsed.data.goal.trim();
    const lang = (parsed.data.language || "pt").slice(0, 12);
    const now = new Date();

    const fallback = () => {
      const due1 = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const due2 = new Date(now.getTime() + 26 * 60 * 60 * 1000);
      const due3 = new Date(now.getTime() + 74 * 60 * 60 * 1000);
      return [
        {
          note: `${goal} — primeiro contato`,
          dueAt: due1.toISOString(),
          score: aiScoreForDue(due1),
          reasons: ["Recomendado agir hoje", "Reduz risco de esquecimento"],
        },
        {
          note: `${goal} — follow-up`,
          dueAt: due2.toISOString(),
          score: aiScoreForDue(due2),
          reasons: ["Sem resposta é comum em 24h", "Mantém ritmo do atendimento"],
        },
        {
          note: `${goal} — último lembrete`,
          dueAt: due3.toISOString(),
          score: aiScoreForDue(due3),
          reasons: ["Evita perder timing", "Aumenta chance de conversão"],
        },
      ];
    };

    const creds = await getAssistOpenAiCredentialsForOrganization(organizationId);
    if (!creds) {
      return reply.send({ suggestions: fallback() });
    }

    const system =
      lang === "en"
        ? "You generate a short follow-up plan. Return ONLY valid JSON."
        : lang === "es"
          ? "Generas un plan corto de seguimiento. Devuelve SOLO JSON válido."
          : "Você gera um plano curto de follow-up. Devolva APENAS JSON válido.";

    const userMessage =
      lang === "en"
        ? `Goal: ${goal}\nNow: ${now.toISOString()}\nReturn JSON: {"suggestions":[{"note":"...","dueAt":"ISO","score":0-100,"reasons":["..."]}]}\nCreate 3 suggestions over next 1-4 days.`
        : lang === "es"
          ? `Objetivo: ${goal}\nAhora: ${now.toISOString()}\nDevuelve JSON: {"suggestions":[{"note":"...","dueAt":"ISO","score":0-100,"reasons":["..."]}]}\nCrea 3 sugerencias para los próximos 1-4 días.`
          : `Objetivo: ${goal}\nAgora: ${now.toISOString()}\nDevolva JSON: {"suggestions":[{"note":"...","dueAt":"ISO","score":0-100,"reasons":["..."]}]}\nCrie 3 sugestões para os próximos 1-4 dias.`;

    try {
      const { text } = await callOpenAiCompatibleChat({
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        model: assistOpenAiModel(),
        temperature: 0.35,
        maxTokens: 500,
        system,
        history: [],
        userMessage,
        signal: AbortSignal.timeout(30_000),
      });
      const raw = text.trim();
      const parsedJson = JSON.parse(raw) as { suggestions?: unknown };
      const suggestions = Array.isArray(parsedJson.suggestions)
        ? parsedJson.suggestions
            .filter((x): x is any => x && typeof x === "object")
            .map((x) => ({
              note: typeof x.note === "string" ? x.note.trim().slice(0, 2000) : "",
              dueAt: typeof x.dueAt === "string" ? x.dueAt.trim() : "",
              score: typeof x.score === "number" ? Math.max(0, Math.min(100, Math.round(x.score))) : 50,
              reasons: Array.isArray(x.reasons)
                ? x.reasons.filter((r: unknown): r is string => typeof r === "string").map((r: string) => r.trim()).filter(Boolean).slice(0, 4)
                : [],
            }))
            .filter((x) => x.note && !Number.isNaN(new Date(x.dueAt).getTime()))
            .slice(0, 5)
        : [];
      return reply.send({ suggestions: suggestions.length ? suggestions : fallback() });
    } catch {
      return reply.send({ suggestions: fallback() });
    }
  });

  app.put<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const parsed = updateReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const existing = await prisma.reminder.findFirst({
      where: { id: request.params.id, userId: request.user.id, organizationId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not Found", message: "Reminder not found", statusCode: 404 });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.note !== undefined) data.note = parsed.data.note;
    if (parsed.data.dueAt !== undefined) data.dueAt = new Date(parsed.data.dueAt);
    if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
    if (parsed.data.status !== undefined) {
      data.status = parsed.data.status;
      data.completed = parsed.data.status === "DONE";
    }
    if (parsed.data.completed !== undefined) {
      data.completed = parsed.data.completed;
      if (parsed.data.status === undefined) {
        data.status = parsed.data.completed ? "DONE" : "TODO";
      }
    }

    const reminder = await prisma.reminder.update({
      where: { id: existing.id },
      data,
      include: { contact: { select: { id: true, name: true, phone: true } } },
    });
    return reminder;
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const organizationId = await resolveTenantOrganizationId(request, reply);
    if (!organizationId) return;

    const res = await prisma.reminder.deleteMany({
      where: { id: request.params.id, userId: request.user.id, organizationId },
    });
    if (res.count === 0) {
      return reply.status(404).send({ error: "Not Found", message: "Reminder not found", statusCode: 404 });
    }
    return reply.status(204).send();
  });
}
