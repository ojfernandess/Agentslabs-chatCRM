import { randomUUID } from "node:crypto";
import type { Bot, ChatbotFlow, Contact, Conversation, Message, Prisma } from "@prisma/client";
import { ChatbotFlowSessionStatus } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { startAutomationExecution } from "./automationExecutionLog.js";
import {
  parseChatbotFlowDefinition,
  parseChatbotVariableDefs,
  substituteChatbotVariables,
  type ChatbotFlowDefinition,
  type ChatbotFlowNode,
  type ChatbotWaitingInput,
} from "./chatbotFlowTypes.js";

type SessionVars = Record<string, string>;

function asSessionVars(raw: unknown): SessionVars {
  if (!raw || typeof raw !== "object") return {};
  const out: SessionVars = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (v != null) out[k] = String(v);
  }
  return out;
}

function findStartNode(flow: ChatbotFlowDefinition): ChatbotFlowNode | null {
  return flow.nodes.find((n) => n.type === "start") ?? flow.nodes[0] ?? null;
}

function nextEdgeTarget(
  flow: ChatbotFlowDefinition,
  sourceId: string,
  branch?: string,
): string | null {
  const edges = flow.edges.filter((e) => e.source === sourceId);
  if (!edges.length) return null;
  if (branch) {
    const match = edges.find((e) => e.branch === branch || e.id.includes(branch));
    if (match) return match.target;
  }
  return edges[0]?.target ?? null;
}

function evaluateCondition(
  field: string,
  op: string,
  expected: string,
  vars: SessionVars,
  contact: Contact,
): boolean {
  let actual = "";
  if (field.startsWith("contact.")) {
    const key = field.slice("contact.".length);
    if (key === "name") actual = contact.name;
    else if (key === "phone") actual = contact.phone;
    else if (key === "email") actual = contact.email ?? "";
  } else {
    actual = vars[field] ?? "";
  }
  const e = expected.trim();
  const a = actual.trim();
  switch (op) {
    case "eq":
      return a === e;
    case "neq":
      return a !== e;
    case "contains":
      return a.toLowerCase().includes(e.toLowerCase());
    case "empty":
      return !a;
    case "not_empty":
      return Boolean(a);
    default:
      return a === e;
  }
}

async function sendBotText(
  organizationId: string,
  botId: string,
  conversation: Conversation,
  contact: Contact,
  body: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const text = body.trim();
  if (!text) return;
  await deliverOutboundWhatsAppMessage({
    organizationId,
    data: {
      contactId: contact.id,
      conversationId: conversation.id,
      type: "TEXT",
      body: text,
    },
    actor: { kind: "agent_bot", botId },
    log,
    newConversation: { status: "PENDING", assignedToId: null },
  });
}

async function sendBotImage(
  organizationId: string,
  botId: string,
  conversation: Conversation,
  contact: Contact,
  mediaUrl: string,
  log: FastifyBaseLogger,
): Promise<void> {
  await deliverOutboundWhatsAppMessage({
    organizationId,
    data: {
      contactId: contact.id,
      conversationId: conversation.id,
      type: "IMAGE",
      mediaUrl,
      body: "",
    },
    actor: { kind: "agent_bot", botId },
    log,
    newConversation: { status: "PENDING", assignedToId: null },
  });
}

function parseChoiceIndex(userText: string, choiceCount: number): number | null {
  const t = userText.trim();
  const n = Number.parseInt(t, 10);
  if (Number.isFinite(n) && n >= 1 && n <= choiceCount) return n - 1;
  return null;
}

export async function dispatchVisualChatbotFlow(input: {
  organizationId: string;
  bot: Bot;
  chatbotFlow: ChatbotFlow;
  conversation: Conversation;
  contact: Contact;
  message: Message;
  log: FastifyBaseLogger;
}): Promise<void> {
  const { organizationId, bot, chatbotFlow, conversation, contact, message, log } = input;
  const userText = (message.body ?? "").trim();
  const flow = parseChatbotFlowDefinition(chatbotFlow.flowDefinition);
  if (!flow?.nodes?.length) {
    log.warn({ chatbotFlowId: chatbotFlow.id }, "visual chatbot flow has no nodes");
    return;
  }

  const exLog = await startAutomationExecution({
    organizationId,
    botId: bot.id,
    conversationId: conversation.id,
    triggerMessageId: message.id,
    workflowKey: "visual_chatbot",
    workflowName: chatbotFlow.name.slice(0, 200),
    log,
  });

  try {
    const varDefs = parseChatbotVariableDefs(chatbotFlow.variables);
    let session = await prisma.chatbotFlowSession.findUnique({
      where: { conversationId: conversation.id },
    });

    const initialVars: SessionVars = {};
    for (const v of varDefs) {
      if (v.value) initialVars[v.name] = v.value;
    }

    if (!session) {
      const start = findStartNode(flow);
      session = await prisma.chatbotFlowSession.create({
        data: {
          organizationId,
          chatbotFlowId: chatbotFlow.id,
          conversationId: conversation.id,
          contactId: contact.id,
          currentNodeId: start?.id ?? null,
          variables: initialVars,
          status: ChatbotFlowSessionStatus.ACTIVE,
        },
      });
      exLog.info({ id: "session", name: "Sessão" }, "Nova sessão de chatbot visual");
    }

    let vars = { ...initialVars, ...asSessionVars(session.variables) };
    let currentId = session.currentNodeId;
    let status = session.status;
    let waiting = session.waitingInput as ChatbotWaitingInput | null;

    if (status === ChatbotFlowSessionStatus.WAITING_INPUT && waiting && userText) {
      const capturedVar = waiting.variableName;
      if (waiting.kind === "choice" && waiting.choices?.length) {
        const idx = parseChoiceIndex(userText, waiting.choices.length);
        if (idx != null) {
          vars = { ...vars, [waiting.variableName]: waiting.choices[idx]!.label };
        } else {
          const match = waiting.choices.find((c) => c.label.toLowerCase() === userText.toLowerCase());
          vars = { ...vars, [waiting.variableName]: match?.label ?? userText };
        }
      } else {
        vars = { ...vars, [waiting.variableName]: userText };
      }
      currentId = nextEdgeTarget(flow, waiting.nodeId) ?? currentId;
      status = ChatbotFlowSessionStatus.ACTIVE;
      waiting = null;
      exLog.debug({ id: "input", name: "Input" }, "Resposta do utilizador capturada", {
        output: { variable: capturedVar },
      });
    } else if (status === ChatbotFlowSessionStatus.COMPLETED) {
      const start = findStartNode(flow);
      currentId = start?.id ?? null;
      status = ChatbotFlowSessionStatus.ACTIVE;
      vars = { ...initialVars };
    }

    const maxSteps = 40;
    let steps = 0;
    const outboundMessages: string[] = [];

    while (steps < maxSteps && status === ChatbotFlowSessionStatus.ACTIVE) {
      steps += 1;
      if (!currentId) {
        currentId = findStartNode(flow)?.id ?? null;
      }
      const node = flow.nodes.find((n) => n.id === currentId);
      if (!node) break;

      exLog.debug({ id: node.id, name: node.type }, `Bloco ${node.type}`);

      switch (node.type) {
        case "start": {
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "text": {
          const content = String(node.data?.content ?? node.data?.body ?? "");
          const rendered = substituteChatbotVariables(content, vars, contact);
          if (rendered) {
            await sendBotText(organizationId, bot.id, conversation, contact, rendered, log);
            outboundMessages.push(rendered);
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "image": {
          const url = String(node.data?.url ?? node.data?.mediaUrl ?? "").trim();
          if (url) {
            await sendBotImage(organizationId, bot.id, conversation, contact, url, log);
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "text_input": {
          const variableName = String(node.data?.variableName ?? "input");
          const prompt = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? "Escreva a sua resposta:"),
            vars,
            contact,
          );
          if (prompt) {
            await sendBotText(organizationId, bot.id, conversation, contact, prompt, log);
            outboundMessages.push(prompt);
          }
          waiting = { nodeId: node.id, kind: "text", variableName, prompt };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
        }
        case "choice_input": {
          const variableName = String(node.data?.variableName ?? "choice");
          const rawChoices = node.data?.choices;
          const choices: { id: string; label: string }[] = Array.isArray(rawChoices)
            ? rawChoices
                .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
                .map((c, i) => ({
                  id: typeof c.id === "string" ? c.id : `c${i}`,
                  label: typeof c.label === "string" ? c.label : `Opção ${i + 1}`,
                }))
            : [
                { id: "1", label: "Sim" },
                { id: "2", label: "Não" },
              ];
          const intro = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? "Escolha uma opção:"),
            vars,
            contact,
          );
          const lines = choices.map((c, i) => `${i + 1}. ${c.label}`);
          const body = [intro, ...lines].filter(Boolean).join("\n");
          await sendBotText(organizationId, bot.id, conversation, contact, body, log);
          outboundMessages.push(body);
          waiting = { nodeId: node.id, kind: "choice", variableName, choices, prompt: intro };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
        }
        case "condition": {
          const field = String(node.data?.field ?? "");
          const op = String(node.data?.operator ?? "eq");
          const value = String(node.data?.value ?? "");
          const pass = evaluateCondition(field, op, value, vars, contact);
          currentId = nextEdgeTarget(flow, node.id, pass ? "yes" : "no");
          continue;
        }
        case "set_variable": {
          const name = String(node.data?.name ?? node.data?.variableName ?? "");
          const value = substituteChatbotVariables(String(node.data?.value ?? ""), vars, contact);
          if (name) vars[name] = value;
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "webhook": {
          const url = String(node.data?.url ?? "").trim();
          const method = String(node.data?.method ?? "POST").toUpperCase();
          const responseVar = String(node.data?.responseVariable ?? "webhook_response");
          if (url) {
            try {
              const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: method !== "GET" ? JSON.stringify({ variables: vars, contact, conversationId: conversation.id }) : undefined,
                signal: AbortSignal.timeout(12_000),
              });
              const text = await res.text();
              vars[responseVar] = text.slice(0, 4000);
            } catch (err) {
              vars[responseVar] = err instanceof Error ? err.message : "error";
            }
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "add_tag": {
          const tagId = String(node.data?.tagId ?? "");
          if (tagId) {
            await prisma.contactTag
              .create({ data: { contactId: contact.id, tagId } })
              .catch(() => {});
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "handoff": {
          const msg = substituteChatbotVariables(
            String(node.data?.message ?? "Vou transferir para um atendente humano."),
            vars,
            contact,
          );
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { awaitingHumanHandoff: true },
          });
          if (msg) {
            await sendBotText(organizationId, bot.id, conversation, contact, msg, log);
            outboundMessages.push(msg);
          }
          status = ChatbotFlowSessionStatus.COMPLETED;
          currentId = null;
          break;
        }
        case "wait": {
          const seconds = Math.min(Number(node.data?.seconds ?? node.data?.minutes ?? 0) * (node.data?.minutes != null ? 60 : 1), 5);
          if (seconds > 0) {
            await new Promise((r) => setTimeout(r, seconds * 1000));
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "jump": {
          const target = String(node.data?.targetNodeId ?? node.data?.nodeId ?? "");
          currentId = target && flow.nodes.some((n) => n.id === target) ? target : nextEdgeTarget(flow, node.id);
          continue;
        }
        case "end":
        case "stop": {
          status = ChatbotFlowSessionStatus.COMPLETED;
          currentId = null;
          break;
        }
        default: {
          currentId = nextEdgeTarget(flow, node.id);
        }
      }

      if (status === ChatbotFlowSessionStatus.WAITING_INPUT || status === ChatbotFlowSessionStatus.COMPLETED) {
        break;
      }
    }

    await prisma.chatbotFlowSession.update({
      where: { id: session.id },
      data: {
        currentNodeId: currentId,
        variables: vars,
        status,
        waitingInput: (waiting ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const lastOutbound = outboundMessages[outboundMessages.length - 1] ?? "";
    if (lastOutbound || userText) {
      await prisma.automationInteraction
        .create({
          data: {
            organizationId,
            botId: bot.id,
            conversationId: conversation.id,
            userMessage: userText.slice(0, 4000),
            assistantMessage: lastOutbound.slice(0, 4000),
            responseType: "visual_chatbot",
            metadata: { chatbotFlowId: chatbotFlow.id, sessionStatus: status },
          },
        })
        .catch(() => {});
    }

    exLog.info(
      { id: "done", name: "Fluxo visual" },
      `Sessão ${status}`,
      { output: { steps, outboundCount: outboundMessages.length } },
    );
    await exLog.completeSuccess();
  } catch (err) {
    log.warn({ err, chatbotFlowId: chatbotFlow.id }, "visual chatbot flow failed");
    await exLog.completeError(err);
  }
}

export function generateChatbotPublicId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
