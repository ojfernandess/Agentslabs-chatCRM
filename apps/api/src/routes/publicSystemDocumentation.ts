import type { FastifyInstance, FastifyReply } from "fastify";
import { isPublicSystemDocumentationEnabled } from "../lib/platformPublicDocs.js";
import { PUBLIC_API_DOCUMENTATION_GROUPS } from "../lib/publicApiDocumentationCatalog.js";

function setCorsPublic(reply: FastifyReply) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Documentação HTTP pública do sistema (sem segredos). Só responde se
 * `platform_settings.public_system_documentation_enabled` for verdadeiro.
 */
export async function publicSystemDocumentationRoutes(app: FastifyInstance): Promise<void> {
  app.options("/system-documentation", async (_request, reply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  });

  app.get("/system-documentation", async (_request, reply) => {
    setCorsPublic(reply);
    const enabled = await isPublicSystemDocumentationEnabled();
    if (!enabled) {
      return reply.status(404).send({ error: "Not Found", message: "Documentation is not public", statusCode: 404 });
    }

    return {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      noticeEn:
        "This catalog lists routes and auth expectations only. It never includes tokens, organization IDs, or payloads with secrets.",
      noticePt:
        "Este catálogo lista apenas rotas e requisitos de autenticação. Nunca inclui tokens, IDs de organização nem segredos.",
      groups: PUBLIC_API_DOCUMENTATION_GROUPS,
    };
  });
}
