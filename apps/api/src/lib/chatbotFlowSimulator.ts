import type { Contact } from "@prisma/client";
import {
  parseChatbotFlowDefinition,
  parseChatbotVariableDefs,
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
import {
  formatInvalidReplyMessage,
  matchChatbotCommand,
  parseChatbotFlowSettings,
} from "./chatbotFlowSettings.js";

export type SimulatorSessionStatus = "ACTIVE" | "WAITING_INPUT" | "WAITING_DELAY" | "COMPLETED";

export interface SimulatorSession {
  currentNodeId: string | null;
  variables: Record<string, string>;
  status: SimulatorSessionStatus;
  waitingInput: ChatbotWaitingInput | null;
}

export interface SimulatorTurnResult {
  messages: string[];
  session: SimulatorSession;
  completed: boolean;
}

function findStartNode(flow: ChatbotFlowDefinition): ChatbotFlowNode | null {
  return flow.nodes.find((n) => n.type === "start") ?? flow.nodes[0] ?? null;
}

function nextEdgeTarget(flow: ChatbotFlowDefinition, sourceId: string, branch?: string): string | null {
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
  vars: Record<string, string>,
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

function parseChoiceIndex(userText: string, choiceCount: number): number | null {
  const t = userText.trim();
  const n = Number.parseInt(t, 10);
  if (Number.isFinite(n) && n >= 1 && n <= choiceCount) return n - 1;
  return null;
}

function simContact(name?: string): Contact {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    name: name?.trim() || "Visitante (simulador)",
    phone: "+5500000000000",
    email: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Contact;
}

export function createSimulatorSession(
  flowDefinition: unknown,
  variableDefs?: unknown,
  contactName?: string,
): SimulatorSession {
  const flow = parseChatbotFlowDefinition(flowDefinition);
  const defs = parseChatbotVariableDefs(variableDefs);
  const vars: Record<string, string> = {};
  for (const v of defs) {
    if (v.value) vars[v.name] = v.value;
  }
  const start = flow ? findStartNode(flow) : null;
  return {
    currentNodeId: start?.id ?? null,
    variables: vars,
    status: "ACTIVE",
    waitingInput: null,
  };
}

export function runSimulatorTurn(options: {
  flowDefinition: unknown;
  flowSettings?: unknown;
  session: SimulatorSession;
  userMessage: string;
  contactName?: string;
}): SimulatorTurnResult {
  const flow = parseChatbotFlowDefinition(options.flowDefinition);
  if (!flow?.nodes.length) {
    return {
      messages: ["Fluxo inválido ou vazio."],
      session: { ...options.session, status: "COMPLETED" },
      completed: true,
    };
  }

  const flowSettings = parseChatbotFlowSettings(options.flowSettings);
  const nodeIdSet = new Set(flow.nodes.map((n) => n.id));

  const contact = simContact(options.contactName);
  const outbound: string[] = [];
  let vars = { ...options.session.variables };
  let currentId = options.session.currentNodeId;
  let status = options.session.status;
  let waiting = options.session.waitingInput;
  const userText = options.userMessage.trim();

  let commandJump = false;
  if (userText) {
    const cmdTarget = matchChatbotCommand(userText, flowSettings.events?.commands, nodeIdSet);
    if (cmdTarget) {
      currentId = cmdTarget;
      status = "ACTIVE";
      waiting = null;
      commandJump = true;
      outbound.push(`[Comando → ${cmdTarget}]`);
    }
  }

  if (!commandJump && status === "WAITING_DELAY" && waiting?.kind === "wait") {
    const due = waiting.resumeAt ? new Date(waiting.resumeAt) <= new Date() : true;
    if (!due) {
      return { messages: [], session: options.session, completed: false };
    }
    currentId = nextEdgeTarget(flow, waiting.nodeId);
    status = "ACTIVE";
    waiting = null;
  } else if (status === "WAITING_INPUT" && waiting && userText && !commandJump) {
    let stayWaiting = false;
    if (waiting.kind === "choice" && waiting.choices?.length) {
      const idx = parseChoiceIndex(userText, waiting.choices.length);
      if (idx != null) {
        vars = { ...vars, [waiting.variableName]: waiting.choices[idx]!.label };
      } else {
        const match = waiting.choices.find((c) => c.label.toLowerCase() === userText.toLowerCase());
        vars = { ...vars, [waiting.variableName]: match?.label ?? userText };
      }
    } else if (waiting.kind !== "wait") {
      if (isChatbotValidatedInputKind(waiting.kind)) {
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
          outbound.push(hint.startsWith("⚠") ? hint : `⚠ ${hint}`);
          stayWaiting = true;
        } else {
          vars = { ...vars, [waiting.variableName]: result.value };
        }
      } else {
        vars = { ...vars, [waiting.variableName]: userText };
      }
    }
    if (!stayWaiting) {
      currentId = nextEdgeTarget(flow, waiting.nodeId) ?? currentId;
      status = "ACTIVE";
      waiting = null;
    }
  } else if (status === "COMPLETED") {
    const start = findStartNode(flow);
    currentId = start?.id ?? null;
    status = "ACTIVE";
    vars = { ...options.session.variables };
    waiting = null;
  }

  const maxSteps = 40;
  let steps = 0;

  while (steps < maxSteps && status === "ACTIVE") {
    steps += 1;
    if (!currentId) currentId = findStartNode(flow)?.id ?? null;
    const node = flow.nodes.find((n) => n.id === currentId);
    if (!node) break;

    switch (node.type) {
      case "start":
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      case "text": {
        const rendered = substituteChatbotVariables(
          String(node.data?.content ?? node.data?.body ?? ""),
          vars,
          contact,
        );
        if (rendered) outbound.push(rendered);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "image": {
        const url = String(node.data?.url ?? node.data?.mediaUrl ?? "").trim();
        if (url) outbound.push(`[Imagem] ${url}`);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "video": {
        const url = String(node.data?.url ?? node.data?.mediaUrl ?? "").trim();
        if (url) outbound.push(`[Vídeo] ${url}`);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "audio": {
        const url = String(node.data?.url ?? node.data?.mediaUrl ?? "").trim();
        if (url) outbound.push(`[Áudio] ${url}`);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "text_input": {
        const prompt = substituteChatbotVariables(
          String(node.data?.prompt ?? node.data?.content ?? "Escreva a sua resposta:"),
          vars,
          contact,
        );
        if (prompt) outbound.push(prompt);
        waiting = {
          nodeId: node.id,
          kind: "text",
          variableName: String(node.data?.variableName ?? "input"),
          prompt,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "email_input": {
        const prompt = substituteChatbotVariables(
          String(node.data?.prompt ?? node.data?.content ?? "Indique o seu email:"),
          vars,
          contact,
        );
        if (prompt) outbound.push(prompt);
        waiting = {
          nodeId: node.id,
          kind: "email",
          variableName: String(node.data?.variableName ?? "email"),
          prompt,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "number_input": {
        const prompt = substituteChatbotVariables(
          String(node.data?.prompt ?? node.data?.content ?? "Indique um número:"),
          vars,
          contact,
        );
        if (prompt) outbound.push(prompt);
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
          variableName: String(node.data?.variableName ?? "numero"),
          prompt,
          numberMin: Number.isFinite(numberMin) ? numberMin : undefined,
          numberMax: Number.isFinite(numberMax) ? numberMax : undefined,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "phone_input": {
        const prompt = substituteChatbotVariables(
          String(node.data?.prompt ?? node.data?.content ?? "Indique o seu telefone (com indicativo):"),
          vars,
          contact,
        );
        if (prompt) outbound.push(prompt);
        waiting = {
          nodeId: node.id,
          kind: "phone",
          variableName: String(node.data?.variableName ?? "telefone"),
          prompt,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "date_input": {
        const prompt = substituteChatbotVariables(
          String(node.data?.prompt ?? node.data?.content ?? "Indique a data (AAAA-MM-DD ou DD/MM/AAAA):"),
          vars,
          contact,
        );
        if (prompt) outbound.push(prompt);
        waiting = {
          nodeId: node.id,
          kind: "date",
          variableName: String(node.data?.variableName ?? "data"),
          prompt,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "rating_input": {
        const rmin = Math.max(1, Math.min(10, Number(node.data?.ratingMin ?? 1) || 1));
        const rmax = Math.max(rmin, Math.min(10, Number(node.data?.ratingMax ?? 5) || 5));
        const basePrompt = String(node.data?.prompt ?? node.data?.content ?? "De quanto a quanto avalia?");
        const withRange = `${basePrompt} (${rmin}–${rmax})`;
        const prompt = substituteChatbotVariables(withRange, vars, contact);
        if (prompt) outbound.push(prompt);
        waiting = {
          nodeId: node.id,
          kind: "rating",
          variableName: String(node.data?.variableName ?? "avaliacao"),
          prompt,
          ratingMin: rmin,
          ratingMax: rmax,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "choice_input": {
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
        if (displayMode === "buttons" && choices.length <= 3) {
          outbound.push(intro ? `${intro}\n[Botões: ${choices.map((c) => c.label).join(" | ")}]` : `[Botões: ${choices.map((c) => c.label).join(" | ")}]`);
        } else {
          const lines = choices.map((c, i) => `${i + 1}. ${c.label}`);
          outbound.push([intro, ...lines].filter(Boolean).join("\n"));
        }
        waiting = {
          nodeId: node.id,
          kind: "choice",
          variableName: String(node.data?.variableName ?? "choice"),
          choices,
          prompt: intro,
        };
        status = "WAITING_INPUT";
        break;
      }
      case "condition": {
        const pass = evaluateCondition(
          String(node.data?.field ?? ""),
          String(node.data?.operator ?? "eq"),
          String(node.data?.value ?? ""),
          vars,
          contact,
        );
        currentId = nextEdgeTarget(flow, node.id, pass ? "yes" : "no");
        continue;
      }
      case "ab_test": {
        const variants = parseAbVariants(node.data?.variants);
        const abVar = String(node.data?.variableName ?? `_ab_${node.id}`);
        const picked = vars[abVar]?.trim() || pickAbTestVariant(variants, `sim:${node.id}`);
        vars = { ...vars, [abVar]: picked };
        outbound.push(`[A/B → ${picked}]`);
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
        outbound.push("[Script executado]");
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "redirect": {
        const url = substituteChatbotVariables(String(node.data?.url ?? "").trim(), vars, contact);
        const msgTpl = String(node.data?.message ?? node.data?.content ?? "").trim();
        const msg = msgTpl
          ? substituteChatbotVariables(msgTpl, vars, contact)
          : url || "";
        if (url) {
          const urlVar = String(node.data?.variableName ?? "redirect_url");
          vars = { ...vars, [urlVar]: url };
        }
        if (msg) outbound.push(msg);
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
        const sendToUser = node.data?.sendToUser === true;
        const mock = prompt ? `[OpenAI simulado] Resposta para: ${prompt.slice(0, 80)}…` : "";
        if (mock) vars = { ...vars, [variableName]: mock };
        if (sendToUser && mock) outbound.push(mock);
        else if (mock) outbound.push(`[OpenAI → {{${variableName}}}]`);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "webhook": {
        outbound.push(`[Webhook ${String(node.data?.method ?? "POST")} → ${String(node.data?.url ?? "")}]`);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      }
      case "add_tag":
        outbound.push(`[Etiqueta ${String(node.data?.tagId ?? "?")}]`);
        currentId = nextEdgeTarget(flow, node.id);
        continue;
      case "handoff": {
        const msg = substituteChatbotVariables(
          String(node.data?.message ?? "Transferência para atendente humano."),
          vars,
          contact,
        );
        if (msg) outbound.push(msg);
        status = "COMPLETED";
        currentId = null;
        break;
      }
      case "wait": {
        const seconds = Math.min(
          Math.max(1, Number(node.data?.seconds ?? 0) || (Number(node.data?.minutes ?? 0) * 60 || 1)),
          300,
        );
        waiting = {
          nodeId: node.id,
          kind: "wait",
          variableName: "_wait",
          resumeAt: new Date(Date.now() + seconds * 1000).toISOString(),
        };
        status = "WAITING_DELAY";
        outbound.push(`[Aguardar ${seconds}s]`);
        break;
      }
      case "jump": {
        const target = String(node.data?.targetNodeId ?? node.data?.nodeId ?? "");
        currentId = target && flow.nodes.some((n) => n.id === target) ? target : nextEdgeTarget(flow, node.id);
        continue;
      }
      case "end":
      case "stop":
        status = "COMPLETED";
        currentId = null;
        break;
      default:
        currentId = nextEdgeTarget(flow, node.id);
    }

    if (status === "WAITING_INPUT" || status === "WAITING_DELAY" || status === "COMPLETED") break;
  }

  return {
    messages: outbound,
    session: {
      currentNodeId: currentId,
      variables: vars,
      status,
      waitingInput: waiting,
    },
    completed: status === "COMPLETED",
  };
}
