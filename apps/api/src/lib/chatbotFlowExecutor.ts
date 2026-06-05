import { randomUUID } from "node:crypto";
import type { Bot, ChatbotFlow, Contact, Conversation, Message, Prisma } from "@prisma/client";
import { ChatbotFlowSessionStatus } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../db.js";
import { getWhatsAppProviderForInbox } from "../providers/factory.js";
import { deliverOutboundWhatsAppMessage } from "./outboundMessage.js";
import { startAutomationExecution } from "./automationExecutionLog.js";
import {
  parseChatbotFlowDefinition,
  parseChatbotVariableDefs,
  resolveChatbotMediaUrl,
  substituteChatbotVariables,
  type ChatbotFlowDefinition,
  type ChatbotFlowNode,
  type ChatbotWaitingInput,
} from "./chatbotFlowTypes.js";
import { isChatbotValidatedInputKind, validateChatbotUserInput } from "./chatbotInputValidation.js";
import {
  applyChatbotScriptAssignments,
  parseAbVariants,
  pickAbTestVariant,
} from "./chatbotFlowLogic.js";
import { runChatbotOpenAiBlock } from "./chatbotOpenAiBlock.js";
import {
  formatInvalidReplyMessage,
  matchChatbotCommand,
  parseChatbotFlowSettings,
} from "./chatbotFlowSettings.js";

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

async function sendBotMedia(
  organizationId: string,
  botId: string,
  conversation: Conversation,
  contact: Contact,
  type: "IMAGE" | "VIDEO" | "AUDIO",
  mediaUrl: string,
  log: FastifyBaseLogger,
  body = "",
): Promise<void> {
  await deliverOutboundWhatsAppMessage({
    organizationId,
    data: {
      contactId: contact.id,
      conversationId: conversation.id,
      type,
      mediaUrl,
      body: body.slice(0, 1024),
    },
    actor: { kind: "agent_bot", botId },
    log,
    newConversation: { status: "PENDING", assignedToId: null },
  });
}

async function sendBotChoice(
  organizationId: string,
  botId: string,
  conversation: Conversation,
  contact: Contact,
  intro: string,
  choices: { id: string; label: string }[],
  displayMode: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const useButtons = displayMode === "buttons" && choices.length > 0 && choices.length <= 3;
  if (useButtons) {
    const provider = await getWhatsAppProviderForInbox(organizationId, conversation.inboxId);
    if (provider) {
      const to = contact.waId && contact.waId.includes("@g.us") ? contact.waId : contact.phone;
      try {
        await provider.sendMessage({
          to,
          type: "INTERACTIVE",
          body: intro || "Escolha uma opção:",
          interactiveButtons: choices.map((c) => ({ id: c.id, title: c.label })),
        });
        const summary = [intro, ...choices.map((c) => `• ${c.label}`)].filter(Boolean).join("\n");
        await prisma.message
          .create({
            data: {
              conversationId: conversation.id,
              direction: "OUTBOUND",
              type: "TEXT",
              body: summary,
              status: "SENT",
            },
          })
          .catch(() => undefined);
        return summary;
      } catch (err) {
        log.warn({ err }, "interactive buttons failed, falling back to numbered list");
      }
    }
  }
  const lines = choices.map((c, i) => `${i + 1}. ${c.label}`);
  const body = [intro, ...lines].filter(Boolean).join("\n");
  await sendBotText(organizationId, botId, conversation, contact, body, log);
  return body;
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
    let invalidInputRetry = false;
    let lastOutboundAssistant = "";

    const flowSettings = parseChatbotFlowSettings(chatbotFlow.settings);
    const nodeIdSet = new Set(flow.nodes.map((n) => n.id));
    let commandJump = false;
    if (userText) {
      const cmdTarget = matchChatbotCommand(userText, flowSettings.events?.commands, nodeIdSet);
      if (cmdTarget) {
        currentId = cmdTarget;
        status = ChatbotFlowSessionStatus.ACTIVE;
        waiting = null;
        commandJump = true;
        exLog.debug({ id: "command", name: "Comando" }, "Salto por comando global", {
          output: { targetNodeId: cmdTarget },
        });
      }
    }

    if (!commandJump && waiting?.kind === "wait" && waiting.resumeAt) {
      if (new Date(waiting.resumeAt) > new Date()) {
        return;
      }
      currentId = nextEdgeTarget(flow, waiting.nodeId) ?? currentId;
      status = ChatbotFlowSessionStatus.ACTIVE;
      waiting = null;
    } else if (status === ChatbotFlowSessionStatus.WAITING_INPUT && waiting && userText && !commandJump) {
      if (waiting.kind === "wait") {
        return;
      }
      const capturedVar = waiting.variableName;
      if (waiting.kind === "choice" && waiting.choices?.length) {
        const byId = waiting.choices.find((c) => c.id === userText);
        if (byId) {
          vars = { ...vars, [waiting.variableName]: byId.label };
        } else {
          const idx = parseChoiceIndex(userText, waiting.choices.length);
          if (idx != null) {
            vars = { ...vars, [waiting.variableName]: waiting.choices[idx]!.label };
          } else {
            const match = waiting.choices.find((c) => c.label.toLowerCase() === userText.toLowerCase());
            vars = { ...vars, [waiting.variableName]: match?.label ?? userText };
          }
        }
      } else if (isChatbotValidatedInputKind(waiting.kind)) {
        const result = validateChatbotUserInput(waiting.kind, userText, {
          numberMin: waiting.numberMin,
          numberMax: waiting.numberMax,
          ratingMin: waiting.ratingMin,
          ratingMax: waiting.ratingMax,
        });
        if (!result.ok) {
          const hint = formatInvalidReplyMessage(
            flowSettings.events?.invalidReplyMessage,
            result.message,
            waiting.prompt,
            (frag) => substituteChatbotVariables(frag, vars, contact),
          );
          await sendBotText(organizationId, bot.id, conversation, contact, hint, log);
          lastOutboundAssistant = hint;
          invalidInputRetry = true;
        } else {
          vars = { ...vars, [waiting.variableName]: result.value };
        }
      } else {
        vars = { ...vars, [waiting.variableName]: userText };
      }
      if (!invalidInputRetry) {
        currentId = nextEdgeTarget(flow, waiting.nodeId) ?? currentId;
        status = ChatbotFlowSessionStatus.ACTIVE;
        waiting = null;
        exLog.debug({ id: "input", name: "Input" }, "Resposta do utilizador capturada", {
          output: { variable: capturedVar },
        });
      }
    } else if (status === ChatbotFlowSessionStatus.COMPLETED) {
      const start = findStartNode(flow);
      currentId = start?.id ?? null;
      status = ChatbotFlowSessionStatus.ACTIVE;
      vars = { ...initialVars };
    }

    const maxSteps = 40;
    let steps = 0;
    const outboundMessages: string[] = [];

    if (invalidInputRetry) {
      await prisma.chatbotFlowSession.update({
        where: { id: session.id },
        data: {
          currentNodeId: currentId,
          variables: vars,
          status: ChatbotFlowSessionStatus.WAITING_INPUT,
          waitingInput: (waiting ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      const lastOutbound = lastOutboundAssistant || (outboundMessages[outboundMessages.length - 1] ?? "");
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
              metadata: { chatbotFlowId: chatbotFlow.id, sessionStatus: status, invalidInput: true },
            },
          })
          .catch(() => {});
      }
      exLog.info(
        { id: "done", name: "Fluxo visual" },
        `Sessão ${status} (validação falhou)`,
        { output: { steps: 0, outboundCount: outboundMessages.length } },
      );
      await exLog.completeSuccess();
      return;
    }

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
          const url = resolveChatbotMediaUrl(node.data, vars, contact);
          const caption = substituteChatbotVariables(
            String(node.data?.caption ?? node.data?.content ?? ""),
            vars,
            contact,
          );
          if (url) {
            await sendBotMedia(organizationId, bot.id, conversation, contact, "IMAGE", url, log, caption);
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "video": {
          const url = resolveChatbotMediaUrl(node.data, vars, contact);
          const caption = substituteChatbotVariables(
            String(node.data?.caption ?? node.data?.content ?? ""),
            vars,
            contact,
          );
          if (url) {
            await sendBotMedia(organizationId, bot.id, conversation, contact, "VIDEO", url, log, caption);
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "audio": {
          const url = resolveChatbotMediaUrl(node.data, vars, contact);
          if (url) {
            await sendBotMedia(organizationId, bot.id, conversation, contact, "AUDIO", url, log);
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
        case "email_input": {
          const variableName = String(node.data?.variableName ?? "email");
          const prompt = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? "Indique o seu email:"),
            vars,
            contact,
          );
          if (prompt) {
            await sendBotText(organizationId, bot.id, conversation, contact, prompt, log);
            outboundMessages.push(prompt);
          }
          waiting = { nodeId: node.id, kind: "email", variableName, prompt };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
        }
        case "number_input": {
          const variableName = String(node.data?.variableName ?? "numero");
          const prompt = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? "Indique um número:"),
            vars,
            contact,
          );
          if (prompt) {
            await sendBotText(organizationId, bot.id, conversation, contact, prompt, log);
            outboundMessages.push(prompt);
          }
          const numberMin =
            node.data?.min != null
              ? Number(node.data.min)
              : node.data?.numberMin != null
                ? Number(node.data.numberMin)
                : undefined;
          const numberMax =
            node.data?.max != null
              ? Number(node.data.max)
              : node.data?.numberMax != null
                ? Number(node.data.numberMax)
                : undefined;
          waiting = {
            nodeId: node.id,
            kind: "number",
            variableName,
            prompt,
            numberMin: Number.isFinite(numberMin) ? numberMin : undefined,
            numberMax: Number.isFinite(numberMax) ? numberMax : undefined,
          };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
        }
        case "phone_input": {
          const variableName = String(node.data?.variableName ?? "telefone");
          const prompt = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? "Indique o seu telefone (com indicativo):"),
            vars,
            contact,
          );
          if (prompt) {
            await sendBotText(organizationId, bot.id, conversation, contact, prompt, log);
            outboundMessages.push(prompt);
          }
          waiting = { nodeId: node.id, kind: "phone", variableName, prompt };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
        }
        case "date_input": {
          const variableName = String(node.data?.variableName ?? "data");
          const prompt = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? "Indique a data (AAAA-MM-DD ou DD/MM/AAAA):"),
            vars,
            contact,
          );
          if (prompt) {
            await sendBotText(organizationId, bot.id, conversation, contact, prompt, log);
            outboundMessages.push(prompt);
          }
          waiting = { nodeId: node.id, kind: "date", variableName, prompt };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
        }
        case "rating_input": {
          const variableName = String(node.data?.variableName ?? "avaliacao");
          const rmin = Math.max(1, Math.min(10, Number(node.data?.ratingMin ?? 1) || 1));
          const rmax = Math.max(rmin, Math.min(10, Number(node.data?.ratingMax ?? 5) || 5));
          const basePrompt = String(node.data?.prompt ?? node.data?.content ?? "De quanto a quanto avalia?");
          const withRange = `${basePrompt} (${rmin}–${rmax})`;
          const prompt = substituteChatbotVariables(withRange, vars, contact);
          if (prompt) {
            await sendBotText(organizationId, bot.id, conversation, contact, prompt, log);
            outboundMessages.push(prompt);
          }
          waiting = {
            nodeId: node.id,
            kind: "rating",
            variableName,
            prompt,
            ratingMin: rmin,
            ratingMax: rmax,
          };
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
          const displayMode = String(node.data?.displayMode ?? "text");
          const body = await sendBotChoice(
            organizationId,
            bot.id,
            conversation,
            contact,
            intro,
            choices,
            displayMode,
            log,
          );
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
        case "ab_test": {
          const variants = parseAbVariants(node.data?.variants);
          const abVar = String(node.data?.variableName ?? `_ab_${node.id}`);
          const seed = `${contact.id}:${node.id}`;
          const picked =
            vars[abVar]?.trim() || pickAbTestVariant(variants, `${session.id}:${seed}`);
          vars = { ...vars, [abVar]: picked };
          currentId = nextEdgeTarget(flow, node.id, picked) ?? nextEdgeTarget(flow, node.id);
          continue;
        }
        case "set_variable": {
          const name = String(node.data?.name ?? node.data?.variableName ?? "");
          const value = substituteChatbotVariables(String(node.data?.value ?? ""), vars, contact);
          if (name) vars[name] = value;
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "script": {
          const code = String(node.data?.code ?? node.data?.script ?? "");
          const sub = (frag: string) => substituteChatbotVariables(frag, vars, contact);
          vars = applyChatbotScriptAssignments(code, vars, sub);
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "redirect": {
          const url = substituteChatbotVariables(
            String(node.data?.url ?? "").trim(),
            vars,
            contact,
          );
          const msgTpl = String(node.data?.message ?? node.data?.content ?? "").trim();
          const msg = msgTpl
            ? substituteChatbotVariables(msgTpl, vars, contact)
            : url
              ? url
              : "";
          if (url) {
            const urlVar = String(node.data?.variableName ?? "redirect_url");
            vars = { ...vars, [urlVar]: url };
          }
          if (msg) {
            await sendBotText(organizationId, bot.id, conversation, contact, msg, log);
            outboundMessages.push(msg);
          }
          currentId = nextEdgeTarget(flow, node.id);
          continue;
        }
        case "openai": {
          const prompt = substituteChatbotVariables(
            String(node.data?.prompt ?? node.data?.content ?? ""),
            vars,
            contact,
          );
          const variableName = String(node.data?.variableName ?? "openai_reply");
          const systemPrompt = substituteChatbotVariables(
            String(node.data?.systemPrompt ?? ""),
            vars,
            contact,
          );
          const model = String(node.data?.model ?? "").trim() || undefined;
          const sendToUser = node.data?.sendToUser === true;
          if (prompt) {
            const result = await runChatbotOpenAiBlock({
              organizationId,
              prompt,
              systemPrompt: systemPrompt || undefined,
              model,
            });
            const text = result.ok ? result.text : `⚠ ${result.error}`;
            vars = { ...vars, [variableName]: text };
            if (sendToUser && text) {
              await sendBotText(organizationId, bot.id, conversation, contact, text, log);
              outboundMessages.push(text);
            }
          }
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
          const rawSeconds =
            Number(node.data?.seconds ?? 0) ||
            (node.data?.minutes != null ? Number(node.data.minutes) * 60 : 0);
          const seconds = Math.min(Math.max(1, rawSeconds || 1), 300);
          waiting = {
            nodeId: node.id,
            kind: "wait",
            variableName: "_wait",
            resumeAt: new Date(Date.now() + seconds * 1000).toISOString(),
          };
          status = ChatbotFlowSessionStatus.WAITING_INPUT;
          break;
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
