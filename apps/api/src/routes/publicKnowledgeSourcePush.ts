import { FastifyInstance } from "fastify";
import { z } from "zod";
import { applyWebhookPush } from "../lib/knowledgeSourceService.js";

const bodySchema = z.object({
  content: z.string().min(1).max(500_000),
  title: z.string().max(500).optional(),
});

/**
 * Push público para fontes KB do tipo `webhook_push` (token no path).
 * Sem JWT — o token actua como segredo.
 */
export async function publicKnowledgeSourcePushRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { token: string } }>("/knowledge-source-push/:token", async (request, reply) => {
    const token = request.params.token?.trim() ?? "";
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return reply.status(404).send({ error: "Not Found", statusCode: 404 });
    }
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Bad Request",
        message: parsed.error.message,
        statusCode: 400,
      });
    }
    const result = await applyWebhookPush({
      token: token.toLowerCase(),
      content: parsed.data.content,
      title: parsed.data.title,
    });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 400;
      return reply.status(status).send({
        error: status === 404 ? "Not Found" : "Bad Request",
        code: result.code,
        message: result.message,
        statusCode: status,
      });
    }
    return { ok: true, articleId: result.articleId };
  });
}
