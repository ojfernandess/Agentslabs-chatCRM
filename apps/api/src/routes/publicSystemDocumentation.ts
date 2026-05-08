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
      schemaVersion: 5,
      generatedAt: new Date().toISOString(),
      noticeEn:
        "This catalog lists routes and auth expectations only. It never includes tokens, organization IDs, or payloads with secrets. Common credentials: (1) user JWT from POST /api/v1/auth/login; (2) profile API token (ocu_...) via `api_access_token` header or `Authorization: Bearer ocu_...` on automation-compatible routes; (3) bot inbox token (Bearer ocb_...) for /api/v1/agent-bot/* and read-only GET /api/v1/bots.",
      noticePt:
        "Este catálogo lista rotas e autenticação. Nunca inclui tokens, IDs de organização nem segredos. Credenciais habituais: (1) JWT (POST /api/v1/auth/login); (2) token de API de perfil (ocu_...) no cabeçalho `api_access_token` ou `Authorization: Bearer ocu_...` nas rotas que aceitam automação; (3) token de inbox do bot (Bearer ocb_...) para /api/v1/agent-bot/* e GET /api/v1/bots (só leitura).",
      groups: PUBLIC_API_DOCUMENTATION_GROUPS,
    };
  });
}
