import type { FastifyInstance, FastifyReply } from "fastify";
import {
  buildPublicSystemDocumentationPayload,
  filterDocumentationGroupsForPostman,
  getPublicSystemDocumentationConfig,
  PUBLIC_SYSTEM_DOCUMENTATION_SCHEMA_VERSION,
} from "../lib/platformPublicDocs.js";
import { buildPostmanCollectionV21 } from "../lib/publicApiDocumentationPostman.js";

function setCorsPublic(reply: FastifyReply) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * Documentação HTTP pública do sistema (sem segredos). Só responde se
 * `platform_settings.public_system_documentation_enabled` estiver activo.
 */
export async function publicSystemDocumentationRoutes(app: FastifyInstance): Promise<void> {
  app.options("/system-documentation", async (_request, reply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  });

  app.get("/system-documentation", async (_request, reply) => {
    setCorsPublic(reply);
    const config = await getPublicSystemDocumentationConfig();
    if (!config.enabled) {
      return reply.status(404).send({ error: "Not Found", message: "Documentation is not public", statusCode: 404 });
    }

    return buildPublicSystemDocumentationPayload(config);
  });

  app.options("/system-documentation/postman", async (_request, reply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  });

  app.get("/system-documentation/postman", async (_request, reply) => {
    setCorsPublic(reply);
    const config = await getPublicSystemDocumentationConfig();
    if (!config.enabled) {
      return reply.status(404).send({ error: "Not Found", message: "Documentation is not public", statusCode: 404 });
    }
    if (!config.sections.postmanDownload) {
      return reply.status(404).send({ error: "Not Found", message: "Postman export is disabled", statusCode: 404 });
    }

    const groups = filterDocumentationGroupsForPostman(config);
    const collection = buildPostmanCollectionV21(groups, PUBLIC_SYSTEM_DOCUMENTATION_SCHEMA_VERSION);
    const filename = `opennexo-crm-api-v${PUBLIC_SYSTEM_DOCUMENTATION_SCHEMA_VERSION}.postman_collection.json`;

    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(collection);
  });
}
