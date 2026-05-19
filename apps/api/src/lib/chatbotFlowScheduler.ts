import type { FastifyInstance } from "fastify";
import { ChatbotFlowSessionStatus } from "@prisma/client";
import { prisma } from "../db.js";
import type { ChatbotWaitingInput } from "./chatbotFlowTypes.js";
import { dispatchVisualChatbotFlow } from "./chatbotFlowExecutor.js";

/** Retoma sessões em bloco wait após resumeAt. */
export async function runChatbotFlowSchedulerTick(app: FastifyInstance): Promise<void> {
  const now = new Date();
  const sessions = await prisma.chatbotFlowSession.findMany({
    where: { status: ChatbotFlowSessionStatus.WAITING_INPUT },
    take: 50,
    include: {
      chatbotFlow: true,
      conversation: { include: { contact: true } },
    },
  });

  for (const session of sessions) {
    const waiting = session.waitingInput as ChatbotWaitingInput | null;
    if (!waiting || waiting.kind !== "wait" || !waiting.resumeAt) continue;
    if (new Date(waiting.resumeAt) > now) continue;
    if (!session.conversation?.contact || !session.chatbotFlow) continue;

    const bot = session.chatbotFlow.linkedBotId
      ? await prisma.bot.findFirst({
          where: { id: session.chatbotFlow.linkedBotId, organizationId: session.organizationId },
        })
      : null;
    if (!bot) continue;

    const syntheticMessage = await prisma.message.create({
      data: {
        conversationId: session.conversation.id,
        direction: "INBOUND",
        type: "TEXT",
        body: "",
        status: "SENT",
      },
    });

    await dispatchVisualChatbotFlow({
      organizationId: session.organizationId,
      bot,
      chatbotFlow: session.chatbotFlow,
      conversation: session.conversation,
      contact: session.conversation.contact,
      message: syntheticMessage,
      log: app.log,
    });
  }
}
