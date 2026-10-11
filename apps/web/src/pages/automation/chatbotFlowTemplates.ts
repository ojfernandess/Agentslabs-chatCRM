import { defaultChatbotFlow, type ChatbotFlowDefinition, type ChatbotFlowNode } from "./chatbotFlowTypes";

export const CHATBOT_FLOW_TEMPLATE_IDS = [
  "blank",
  "hospitality",
  "sales",
  "service",
  "support",
  "legal",
  "clinic",
  "food",
] as const;

export type ChatbotFlowTemplateId = (typeof CHATBOT_FLOW_TEMPLATE_IDS)[number];

export const CHATBOT_TEMPLATE_LABEL_KEYS: Record<ChatbotFlowTemplateId, { name: string; description: string }> = {
  blank: { name: "chatbotPage.templateBlank", description: "chatbotPage.templateBlankDesc" },
  hospitality: { name: "chatbotPage.templateHospitality", description: "chatbotPage.templateHospitalityDesc" },
  sales: { name: "chatbotPage.templateSales", description: "chatbotPage.templateSalesDesc" },
  service: { name: "chatbotPage.templateService", description: "chatbotPage.templateServiceDesc" },
  support: { name: "chatbotPage.templateSupport", description: "chatbotPage.templateSupportDesc" },
  legal: { name: "chatbotPage.templateLegal", description: "chatbotPage.templateLegalDesc" },
  clinic: { name: "chatbotPage.templateClinic", description: "chatbotPage.templateClinicDesc" },
  food: { name: "chatbotPage.templateFood", description: "chatbotPage.templateFoodDesc" },
};

type Step = { id: string; type: string; data?: Record<string, unknown> };

function chain(steps: Step[]): ChatbotFlowDefinition {
  const nodes: ChatbotFlowNode[] = steps.map((step, index) => ({
    id: step.id,
    type: step.type,
    position: { x: 80 + index * 300, y: 180 },
    data: step.data ?? {},
  }));
  const edges = steps.slice(1).map((step, index) => ({
    id: `e_${steps[index]!.id}_${step.id}`,
    source: steps[index]!.id,
    target: step.id,
  }));
  return { nodes, edges };
}

function choice(prompt: string, variableName: string, labels: string[]) {
  return {
    prompt,
    variableName,
    displayMode: "text",
    choices: labels.map((label, index) => ({ id: String(index + 1), label })),
  };
}

function text(content: string) {
  return { content };
}

function input(type: string, variableName: string, prompt: string): Step {
  return { id: variableName, type, data: { variableName, prompt } };
}

/**
 * Starter graphs for a new chatbot. "blank" is the existing default flow.
 * Templates only use blocks the executor already understands.
 */
export function chatbotFlowFromTemplate(
  id: ChatbotFlowTemplateId,
  textOf: (key: string) => string,
): { name: string; description: string; flow: ChatbotFlowDefinition } {
  if (id === "blank") {
    return {
      name: textOf("chatbotPage.newFlowName"),
      description: "",
      flow: defaultChatbotFlow(),
    };
  }

  const handoff = textOf("chatbotPage.tplHandoff");
  const menu = textOf("chatbotPage.tplMenuPrompt");
  const end: Step = { id: "end", type: "end" };
  const transfer: Step = { id: "handoff", type: "handoff", data: { message: handoff } };

  if (id === "hospitality") {
    return {
      name: textOf("chatbotPage.tplHospitalityName"),
      description: textOf("chatbotPage.tplHospitalityDesc"),
      flow: chain([
        { id: "start", type: "start" },
        { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplHospitalityWelcome")) },
        {
          id: "menu",
          type: "choice_input",
          data: choice(menu, "opcao", [
            textOf("chatbotPage.tplHospitalityOpt1"),
            textOf("chatbotPage.tplHospitalityOpt2"),
            textOf("chatbotPage.tplHospitalityOpt3"),
          ]),
        },
        input("text_input", "detalhes", textOf("chatbotPage.tplHospitalityAsk")),
        transfer,
        end,
      ]),
    };
  }

  if (id === "sales") {
    return {
      name: textOf("chatbotPage.tplSalesName"),
      description: textOf("chatbotPage.tplSalesDesc"),
      flow: chain([
        { id: "start", type: "start" },
        { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplSalesWelcome")) },
        input("text_input", "interesse", textOf("chatbotPage.tplSalesAsk")),
        input("phone_input", "telefone", textOf("chatbotPage.tplAskPhone")),
        transfer,
        end,
      ]),
    };
  }

  if (id === "service") {
    return {
      name: textOf("chatbotPage.tplServiceName"),
      description: textOf("chatbotPage.tplServiceDesc"),
      flow: chain([
        { id: "start", type: "start" },
        { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplServiceWelcome")) },
        input("text_input", "assunto", textOf("chatbotPage.tplServiceAsk")),
        transfer,
        end,
      ]),
    };
  }

  if (id === "support") {
    return {
      name: textOf("chatbotPage.tplSupportName"),
      description: textOf("chatbotPage.tplSupportDesc"),
      flow: chain([
        { id: "start", type: "start" },
        { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplSupportWelcome")) },
        {
          id: "menu",
          type: "choice_input",
          data: choice(menu, "opcao", [
            textOf("chatbotPage.tplSupportOpt1"),
            textOf("chatbotPage.tplSupportOpt2"),
            textOf("chatbotPage.tplSupportOpt3"),
          ]),
        },
        input("text_input", "descricao", textOf("chatbotPage.tplSupportAsk")),
        transfer,
        end,
      ]),
    };
  }

  if (id === "legal") {
    return {
      name: textOf("chatbotPage.tplLegalName"),
      description: textOf("chatbotPage.tplLegalDesc"),
      flow: chain([
        { id: "start", type: "start" },
        { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplLegalWelcome")) },
        input("text_input", "area", textOf("chatbotPage.tplLegalAsk")),
        input("text_input", "nome", textOf("chatbotPage.tplLegalNameAsk")),
        transfer,
        end,
      ]),
    };
  }

  if (id === "clinic") {
    return {
      name: textOf("chatbotPage.tplClinicName"),
      description: textOf("chatbotPage.tplClinicDesc"),
      flow: chain([
        { id: "start", type: "start" },
        { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplClinicWelcome")) },
        {
          id: "menu",
          type: "choice_input",
          data: choice(menu, "opcao", [
            textOf("chatbotPage.tplClinicOpt1"),
            textOf("chatbotPage.tplClinicOpt2"),
            textOf("chatbotPage.tplClinicOpt3"),
          ]),
        },
        input("phone_input", "telefone", textOf("chatbotPage.tplAskPhone")),
        input("date_input", "data", textOf("chatbotPage.tplAskDate")),
        transfer,
        end,
      ]),
    };
  }

  return {
    name: textOf("chatbotPage.tplFoodName"),
    description: textOf("chatbotPage.tplFoodDesc"),
    flow: chain([
      { id: "start", type: "start" },
      { id: "welcome", type: "text", data: text(textOf("chatbotPage.tplFoodWelcome")) },
      {
        id: "menu",
        type: "choice_input",
        data: choice(menu, "opcao", [
          textOf("chatbotPage.tplFoodOpt1"),
          textOf("chatbotPage.tplFoodOpt2"),
          textOf("chatbotPage.tplFoodOpt3"),
        ]),
      },
      input("text_input", "pedido", textOf("chatbotPage.tplFoodAsk")),
      input("phone_input", "telefone", textOf("chatbotPage.tplAskPhone")),
      transfer,
      end,
    ]),
  };
}
