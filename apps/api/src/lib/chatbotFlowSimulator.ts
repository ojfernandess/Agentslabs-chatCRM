import type { Contact } from "@prisma/client";
import {
  parseChatbotFlowDefinition,
  parseChatbotVariableDefs,
  substituteChatbotVariables,
  type ChatbotFlowDefinition,
  type ChatbotFlowNode,
  type ChatbotWaitingInput,
} from "./chatbotFlowTypes.js";

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

  const contact = simContact(options.contactName);
  const outbound: string[] = [];
  let vars = { ...options.session.variables };
  let currentId = options.session.currentNodeId;
  let status = options.session.status;
  let waiting = options.session.waitingInput;
  const userText = options.userMessage.trim();

  if (status === "WAITING_DELAY" && waiting?.kind === "wait") {
    const due = waiting.resumeAt ? new Date(waiting.resumeAt) <= new Date() : true;
    if (!due) {
      return { messages: [], session: options.session, completed: false };
    }
    currentId = nextEdgeTarget(flow, waiting.nodeId);
    status = "ACTIVE";
    waiting = null;
  } else if (status === "WAITING_INPUT" && waiting && userText) {
    if (waiting.kind === "choice" && waiting.choices?.length) {
      const idx = parseChoiceIndex(userText, waiting.choices.length);
      if (idx != null) {
        vars = { ...vars, [waiting.variableName]: waiting.choices[idx]!.label };
      } else {
        const match = waiting.choices.find((c) => c.label.toLowerCase() === userText.toLowerCase());
        vars = { ...vars, [waiting.variableName]: match?.label ?? userText };
      }
    } else if (waiting.kind !== "wait") {
      vars = { ...vars, [waiting.variableName]: userText };
    }
    currentId = nextEdgeTarget(flow, waiting.nodeId) ?? currentId;
    status = "ACTIVE";
    waiting = null;
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
      case "set_variable": {
        const name = String(node.data?.name ?? node.data?.variableName ?? "");
        const value = substituteChatbotVariables(String(node.data?.value ?? ""), vars, contact);
        if (name) vars[name] = value;
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
