import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { normalizeCsatRatingType } from "../lib/csatRatingType.js";
import { defaultCsatSurveyIntro } from "../lib/csatSurvey.js";

const postSchema = z.object({
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  comment: z.string().max(2000).optional(),
});

export async function publicCsatRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>("/:token", async (request, reply) => {
    const token = request.params.token?.trim();
    if (!token) {
      return reply.status(400).send({ error: "Bad Request", message: "Missing token", statusCode: 400 });
    }

    const conv = await prisma.conversation.findFirst({
      where: { csatSurveyToken: token },
      include: {
        organization: { select: { name: true } },
      },
    });
    if (!conv) {
      return reply.status(404).send({ error: "Not Found", message: "Invalid or expired link", statusCode: 404 });
    }

    if (conv.status !== "RESOLVED") {
      return reply.status(410).send({ error: "Gone", message: "Survey is no longer available", statusCode: 410 });
    }

    const settings = await prisma.settings.findUnique({
      where: { organizationId: conv.organizationId },
      select: { csatSurveyMessage: true, csatRatingType: true },
    });
    const intro = settings?.csatSurveyMessage?.trim() || defaultCsatSurveyIntro();
    const ratingType = normalizeCsatRatingType(settings?.csatRatingType);

    if (conv.csatScore != null) {
      return {
        organizationName: conv.organization.name,
        introText: intro,
        ratingType,
        alreadySubmitted: true as const,
        score: conv.csatScore,
        comment: conv.csatComment,
      };
    }

    return {
      organizationName: conv.organization.name,
      introText: intro,
      ratingType,
      alreadySubmitted: false as const,
    };
  });

  app.post<{ Params: { token: string } }>("/:token", async (request, reply) => {
    const token = request.params.token?.trim();
    if (!token) {
      return reply.status(400).send({ error: "Bad Request", message: "Missing token", statusCode: 400 });
    }

    const parsed = postSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", message: parsed.error.message, statusCode: 400 });
    }

    const comment = parsed.data.comment?.trim() || null;

    const result = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.findFirst({
        where: { csatSurveyToken: token },
      });
      if (!conv) {
        return { err: 404 as const };
      }
      if (conv.status !== "RESOLVED") {
        return { err: 410 as const };
      }
      if (conv.csatScore != null) {
        return {
          ok: true as const,
          score: conv.csatScore,
          comment: conv.csatComment,
          duplicate: true as const,
        };
      }

      const recordedAt = new Date();
      const updated = await tx.conversation.update({
        where: { id: conv.id },
        data: {
          csatScore: parsed.data.score,
          csatComment: comment,
          csatRecordedAt: recordedAt,
          csatSurveyToken: null,
        },
        select: { csatScore: true, csatComment: true },
      });
      const closure = await tx.conversationClosureRecord.findFirst({
        where: { conversationId: conv.id },
        orderBy: { sessionIndex: "desc" },
        select: { id: true },
      });
      if (closure) {
        await tx.conversationClosureRecord.update({
          where: { id: closure.id },
          data: {
            csatScore: parsed.data.score,
            csatComment: comment,
            csatRecordedAt: recordedAt,
          },
        });
      }
      return { ok: true as const, score: updated.csatScore!, comment: updated.csatComment, duplicate: false as const };
    });

    if ("err" in result && result.err === 404) {
      return reply.status(404).send({ error: "Not Found", message: "Invalid or expired link", statusCode: 404 });
    }
    if ("err" in result && result.err === 410) {
      return reply.status(410).send({ error: "Gone", message: "Survey is no longer available", statusCode: 410 });
    }

    return {
      ok: true,
      score: result.score,
      comment: result.comment,
      duplicate: result.duplicate,
    };
  });
}
