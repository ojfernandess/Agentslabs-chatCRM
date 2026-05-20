import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { getPublicOrigin } from "../config.js";
import {
  parseChatbotFlowDefinition,
  parseChatbotVariableDefs,
} from "../lib/chatbotFlowTypes.js";
import { parseChatbotFlowTheme, DEFAULT_CHATBOT_THEME } from "../lib/chatbotFlowSettings.js";
import {
  createSimulatorSession,
  runSimulatorTurn,
  type SimulatorSession,
} from "../lib/chatbotFlowSimulator.js";

function setCorsPublic(reply: FastifyReply): void {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
}

const publicChatSchema = z.object({
  message: z.string().max(4000).default(""),
  contactName: z.string().max(200).optional(),
  session: z
    .object({
      currentNodeId: z.string().nullable().optional(),
      variables: z.record(z.string()).optional(),
      status: z.enum(["ACTIVE", "WAITING_INPUT", "WAITING_DELAY", "COMPLETED"]).optional(),
      waitingInput: z.record(z.unknown()).nullable().optional(),
    })
    .optional(),
  reset: z.boolean().optional(),
});

async function loadPublishedFlow(publicId: string) {
  return prisma.chatbotFlow.findFirst({
    where: { publicId, isPublished: true },
    select: {
      id: true,
      name: true,
      description: true,
      publicId: true,
      flowDefinition: true,
      variables: true,
      theme: true,
      settings: true,
    },
  });
}

export async function publicChatbotFlowRoutes(app: FastifyInstance): Promise<void> {
  const opts = async (_request: unknown, reply: FastifyReply) => {
    setCorsPublic(reply);
    return reply.status(204).send();
  };

  app.options("/api/v1/public/chatbot/:publicId", opts);
  app.options("/api/v1/public/chatbot/:publicId/chat", opts);

  app.get<{ Params: { publicId: string } }>(
    "/api/v1/public/chatbot/:publicId",
    async (request, reply) => {
      setCorsPublic(reply);
      const publicId = request.params.publicId?.trim();
      if (!publicId) {
        return reply.status(400).send({ error: "Bad Request", statusCode: 400 });
      }

      const flow = await loadPublishedFlow(publicId);
      if (!flow) {
        return reply.status(404).send({ error: "Not Found", message: "Flow not published", statusCode: 404 });
      }

      const def = parseChatbotFlowDefinition(flow.flowDefinition);
      const theme = parseChatbotFlowTheme(flow.theme);
      const varDefs = parseChatbotVariableDefs(flow.variables).map((v) => ({
        name: v.name,
        hasDefault: Boolean(v.value),
      }));

      return {
        publicId: flow.publicId,
        name: flow.name,
        description: flow.description,
        theme,
        variableNames: varDefs.map((v) => v.name),
        nodeCount: def?.nodes.length ?? 0,
        embedUrl: `${getPublicOrigin()}/chatbot/${flow.publicId}`,
        apiBase: `${getPublicOrigin()}/api/v1/public/chatbot/${flow.publicId}`,
      };
    },
  );

  app.post<{ Params: { publicId: string } }>(
    "/api/v1/public/chatbot/:publicId/chat",
    async (request, reply) => {
      setCorsPublic(reply);
      const publicId = request.params.publicId?.trim();
      if (!publicId) {
        return reply.status(400).send({ error: "Bad Request", statusCode: 400 });
      }

      const parsed = publicChatSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Validation", message: parsed.error.message, statusCode: 400 });
      }

      const flow = await loadPublishedFlow(publicId);
      if (!flow) {
        return reply.status(404).send({ error: "Not Found", message: "Flow not published", statusCode: 404 });
      }

      const def = parseChatbotFlowDefinition(flow.flowDefinition);
      if (!def) {
        return reply.status(400).send({ error: "Validation", message: "Invalid flow", statusCode: 400 });
      }

      let session: SimulatorSession;
      if (parsed.data.reset || !parsed.data.session) {
        session = createSimulatorSession(
          flow.flowDefinition,
          flow.variables,
          parsed.data.contactName,
        );
      } else {
        session = {
          currentNodeId: parsed.data.session.currentNodeId ?? null,
          variables: parsed.data.session.variables ?? {},
          status: parsed.data.session.status ?? "ACTIVE",
          waitingInput: (parsed.data.session.waitingInput as SimulatorSession["waitingInput"]) ?? null,
        };
      }

      const turn = runSimulatorTurn({
        flowDefinition: flow.flowDefinition,
        flowSettings: flow.settings,
        session,
        userMessage: parsed.data.message,
        contactName: parsed.data.contactName,
      });

      return {
        ok: true,
        messages: turn.messages,
        session: turn.session,
        completed: turn.completed,
        theme: parseChatbotFlowTheme(flow.theme) ?? DEFAULT_CHATBOT_THEME,
      };
    },
  );
}
