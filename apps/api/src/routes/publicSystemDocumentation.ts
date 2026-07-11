import type { FastifyInstance, FastifyReply } from "fastify";
import { isPublicSystemDocumentationEnabled } from "../lib/platformPublicDocs.js";
import {
  PUBLIC_API_DOCUMENTATION_GROUPS,
  enrichDocumentationGroups,
  PUBLIC_API_DOCUMENTATION_CONVENTIONS,
  PUBLIC_API_DOCUMENTATION_SCHEMAS,
  PUBLIC_API_DOCUMENTATION_CHANGELOG,
} from "../lib/publicApiDocumentationCatalog.js";
import { buildPostmanCollectionV21 } from "../lib/publicApiDocumentationPostman.js";

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
      schemaVersion: 10,
      generatedAt: new Date().toISOString(),
      noticeEn:
        "This catalog lists routes, auth, request/response examples and error codes. It never includes real tokens, organization IDs, or secrets.",
      noticePt:
        "Este catálogo lista rotas, autenticação, exemplos de pedido/resposta e códigos de erro. Nunca inclui tokens reais, IDs de organização nem segredos. Ver «Convenções gerais» e «Modelos de dados» antes dos endpoints.",
      conventions: PUBLIC_API_DOCUMENTATION_CONVENTIONS,
      schemas: PUBLIC_API_DOCUMENTATION_SCHEMAS,
      changelog: PUBLIC_API_DOCUMENTATION_CHANGELOG,
      groups: enrichDocumentationGroups(PUBLIC_API_DOCUMENTATION_GROUPS),
    };
  });

  app.options("/system-documentation/postman", async (_request, reply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  });

  app.get("/system-documentation/postman", async (_request, reply) => {
    setCorsPublic(reply);
    const enabled = await isPublicSystemDocumentationEnabled();
    if (!enabled) {
      return reply.status(404).send({ error: "Not Found", message: "Documentation is not public", statusCode: 404 });
    }

    const schemaVersion = 10;
    const groups = enrichDocumentationGroups(PUBLIC_API_DOCUMENTATION_GROUPS);
    const collection = buildPostmanCollectionV21(groups, schemaVersion);
    const filename = `opennexo-crm-api-v${schemaVersion}.postman_collection.json`;

    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(collection);
  });
}
