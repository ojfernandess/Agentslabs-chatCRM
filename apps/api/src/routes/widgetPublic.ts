import type { FastifyInstance, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";
import { getPublicOrigin } from "../config.js";
import { publicWebsiteWidgetSettings, WIDGET_SDK_VERSION } from "../lib/websiteWidget.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function setCorsPublic(reply: FastifyReply): void {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  reply.header("Cross-Origin-Resource-Policy", "cross-origin");
}

function resolveWidgetScriptPath(): string {
  const candidates = [
    join(__dirname, "../../public/opennexo-widget.js"),
    join(process.cwd(), "apps/api/public/opennexo-widget.js"),
    join(process.cwd(), "public/opennexo-widget.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export async function widgetPublicRoutes(app: FastifyInstance): Promise<void> {
  app.options("/api/v1/public/widget/:token/settings", async (_request, reply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  });

  app.get<{ Params: { token: string } }>("/api/v1/public/widget/:token/settings", async (request, reply) => {
    setCorsPublic(reply);
    reply.header("Cache-Control", "no-store, max-age=0");
    const token = request.params.token?.trim();
    if (!token) {
      return reply.status(400).send({ error: "Bad Request", statusCode: 400 });
    }
    const inbox = await prisma.inbox.findFirst({
      where: { ingestToken: token, channelType: "WEBSITE" },
      select: {
        name: true,
        channelConfig: true,
        organization: { select: { isActive: true } },
      },
    });
    if (!inbox || !inbox.organization.isActive) {
      return reply.status(404).send({ error: "Not Found", statusCode: 404 });
    }
    return {
      ...publicWebsiteWidgetSettings(inbox.name, inbox.channelConfig),
      baseUrl: getPublicOrigin(),
      websiteToken: token,
    };
  });

  app.get("/api/v1/public/widget/opennexo-widget.js", async (_request, reply) => {
    setCorsPublic(reply);
    const path = resolveWidgetScriptPath();
    try {
      const js = await readFile(path, "utf8");
      reply.header("Cache-Control", "public, max-age=86400");
      reply.header("ETag", `"${WIDGET_SDK_VERSION}"`);
      return reply.type("application/javascript; charset=utf-8").send(js);
    } catch (err) {
      reply.log.warn({ err, path }, "widget_script_not_found");
      return reply.status(404).send({ error: "Not Found", statusCode: 404 });
    }
  });
}
