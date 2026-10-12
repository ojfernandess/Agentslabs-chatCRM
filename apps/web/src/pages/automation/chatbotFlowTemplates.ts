import {
  defaultChatbotFlow,
  type ChatbotFlowDefinition,
  type ChatbotFlowEdge,
  type ChatbotFlowNode,
} from "./chatbotFlowTypes";

export const CHATBOT_FLOW_TEMPLATE_IDS = [
  "blank",
  "hospitality",
  "sales",
  "service",
  "support",
  "legal",
  "clinic",
  "food",
  "realestate",
  "education",
  "beauty",
  "automotive",
  "retail",
  "travel",
  "fitness",
  "events",
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
  realestate: { name: "chatbotPage.templateRealEstate", description: "chatbotPage.templateRealEstateDesc" },
  education: { name: "chatbotPage.templateEducation", description: "chatbotPage.templateEducationDesc" },
  beauty: { name: "chatbotPage.templateBeauty", description: "chatbotPage.templateBeautyDesc" },
  automotive: { name: "chatbotPage.templateAutomotive", description: "chatbotPage.templateAutomotiveDesc" },
  retail: { name: "chatbotPage.templateRetail", description: "chatbotPage.templateRetailDesc" },
  travel: { name: "chatbotPage.templateTravel", description: "chatbotPage.templateTravelDesc" },
  fitness: { name: "chatbotPage.templateFitness", description: "chatbotPage.templateFitnessDesc" },
  events: { name: "chatbotPage.templateEvents", description: "chatbotPage.templateEventsDesc" },
};

type Ask = {
  type: "text_input" | "phone_input" | "email_input" | "date_input";
  variable: string;
  prompt: string;
};

/** Last route is the fallback when the reply does not match an earlier option. */
type Route = {
  id: string;
  label: string;
  asks?: Ask[];
  reply?: string;
  finish: "handoff" | "end";
};

function choice(prompt: string, variableName: string, labels: string[]) {
  return {
    prompt,
    variableName,
    displayMode: "text",
    choices: labels.map((label, index) => ({ id: String(index + 1), label })),
  };
}

function firstStepId(route: Route): string {
  const ask = route.asks?.[0];
  if (ask) return `${route.id}_${ask.variable}`;
  if (route.reply) return `${route.id}_reply`;
  return route.finish === "handoff" ? "handoff" : "end";
}

/**
 * Menu plus one condition per option except the last.
 * The executor stores the chosen label and continues on the first edge,
 * so the split has to be a condition on that label.
 */
function routedFlow(welcome: string, menuPrompt: string, routes: Route[], handoffMessage: string): ChatbotFlowDefinition {
  const nodes: ChatbotFlowNode[] = [];
  const edges: ChatbotFlowEdge[] = [];
  const pushNode = (id: string, type: string, data: Record<string, unknown>, x: number, y: number) => {
    nodes.push({ id, type, position: { x, y }, data });
  };
  const link = (source: string, target: string, branch?: "yes" | "no") => {
    edges.push({
      id: branch ? `e_${source}_${target}_${branch}` : `e_${source}_${target}`,
      source,
      target,
      ...(branch ? { branch } : {}),
    });
  };

  pushNode("start", "start", {}, 40, 240);
  pushNode("welcome", "text", { content: welcome }, 320, 220);
  pushNode("menu", "choice_input", choice(menuPrompt, "opcao", routes.map((route) => route.label)), 620, 200);
  link("start", "welcome");
  link("welcome", "menu");
  pushNode("handoff", "handoff", { message: handoffMessage }, 1760, 80);
  pushNode("end", "end", {}, 2060, 420);

  const condCount = Math.max(0, routes.length - 1);
  for (let index = 0; index < condCount; index += 1) {
    const route = routes[index]!;
    pushNode(
      `c${index + 1}`,
      "condition",
      { field: "opcao", operator: "eq", value: route.label },
      960,
      80 + index * 180,
    );
  }

  if (condCount === 0) {
    link("menu", firstStepId(routes[0]!));
  } else {
    link("menu", "c1");
    for (let index = 0; index < condCount; index += 1) {
      const condId = `c${index + 1}`;
      link(condId, firstStepId(routes[index]!), "yes");
      const next =
        index + 1 < condCount ? `c${index + 2}` : firstStepId(routes[routes.length - 1]!);
      link(condId, next, "no");
    }
  }

  routes.forEach((route, index) => {
    const y = 80 + index * 200;
    let x = 1280;
    const ids: string[] = [];
    for (const ask of route.asks ?? []) {
      const id = `${route.id}_${ask.variable}`;
      pushNode(id, ask.type, { variableName: ask.variable, prompt: ask.prompt }, x, y);
      ids.push(id);
      x += 280;
    }
    if (route.reply) {
      const id = `${route.id}_reply`;
      pushNode(id, "text", { content: route.reply }, x, y);
      ids.push(id);
    }
    for (let step = 1; step < ids.length; step += 1) link(ids[step - 1]!, ids[step]!);
    const last = ids[ids.length - 1];
    if (last && last !== "handoff" && last !== "end") {
      link(last, route.finish === "handoff" ? "handoff" : "end");
    }
  });

  return { nodes, edges };
}

function named(
  textOf: (key: string) => string,
  nameKey: string,
  descKey: string,
  welcomeKey: string,
  routes: Route[],
) {
  return {
    name: textOf(nameKey),
    description: textOf(descKey),
    flow: routedFlow(textOf(welcomeKey), textOf("chatbotPage.tplMenuPrompt"), routes, textOf("chatbotPage.tplHandoff")),
  };
}

/**
 * Starter graphs for a new chatbot. "blank" is the existing default flow.
 * Templates only use blocks the executor already understands.
 * Saved flows are not rewritten.
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

  const confirm = textOf("chatbotPage.tplConfirm");
  const info = textOf("chatbotPage.tplInfo");
  const phone = textOf("chatbotPage.tplAskPhone");
  const date = textOf("chatbotPage.tplAskDate");
  const ticket = textOf("chatbotPage.tplTicketAsk");

  if (id === "hospitality") {
    return named(textOf, "chatbotPage.tplHospitalityName", "chatbotPage.tplHospitalityDesc", "chatbotPage.tplHospitalityWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplHospitalityOpt1"),
        asks: [{ type: "text_input", variable: "detalhes", prompt: textOf("chatbotPage.tplHospitalityAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      {
        id: "r2",
        label: textOf("chatbotPage.tplHospitalityOpt2"),
        asks: [{ type: "text_input", variable: "reserva", prompt: textOf("chatbotPage.tplReservationAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplHospitalityOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "sales") {
    return named(textOf, "chatbotPage.tplSalesName", "chatbotPage.tplSalesDesc", "chatbotPage.tplSalesWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplSalesOpt1"),
        asks: [
          { type: "text_input", variable: "interesse", prompt: textOf("chatbotPage.tplSalesAsk") },
          { type: "phone_input", variable: "telefone", prompt: phone },
        ],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r2", label: textOf("chatbotPage.tplSalesOpt2"), reply: info, finish: "end" },
      { id: "r3", label: textOf("chatbotPage.tplSalesOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "service") {
    return named(textOf, "chatbotPage.tplServiceName", "chatbotPage.tplServiceDesc", "chatbotPage.tplServiceWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplServiceOpt1"),
        asks: [{ type: "text_input", variable: "assunto", prompt: textOf("chatbotPage.tplServiceAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      {
        id: "r2",
        label: textOf("chatbotPage.tplServiceOpt2"),
        asks: [{ type: "text_input", variable: "protocolo", prompt: ticket }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplServiceOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "support") {
    return named(textOf, "chatbotPage.tplSupportName", "chatbotPage.tplSupportDesc", "chatbotPage.tplSupportWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplSupportOpt1"),
        asks: [{ type: "text_input", variable: "descricao", prompt: textOf("chatbotPage.tplSupportAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      {
        id: "r2",
        label: textOf("chatbotPage.tplSupportOpt2"),
        asks: [{ type: "text_input", variable: "protocolo", prompt: ticket }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplSupportOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "legal") {
    return named(textOf, "chatbotPage.tplLegalName", "chatbotPage.tplLegalDesc", "chatbotPage.tplLegalWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplLegalOpt1"),
        asks: [
          { type: "text_input", variable: "area", prompt: textOf("chatbotPage.tplLegalAsk") },
          { type: "text_input", variable: "nome", prompt: textOf("chatbotPage.tplLegalNameAsk") },
        ],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r2", label: textOf("chatbotPage.tplLegalOpt2"), reply: info, finish: "end" },
      { id: "r3", label: textOf("chatbotPage.tplLegalOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "clinic") {
    return named(textOf, "chatbotPage.tplClinicName", "chatbotPage.tplClinicDesc", "chatbotPage.tplClinicWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplClinicOpt1"),
        asks: [
          { type: "phone_input", variable: "telefone", prompt: phone },
          { type: "date_input", variable: "data", prompt: date },
        ],
        reply: confirm,
        finish: "handoff",
      },
      {
        id: "r2",
        label: textOf("chatbotPage.tplClinicOpt2"),
        asks: [{ type: "text_input", variable: "paciente", prompt: textOf("chatbotPage.tplPatientAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplClinicOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "food") {
    return named(textOf, "chatbotPage.tplFoodName", "chatbotPage.tplFoodDesc", "chatbotPage.tplFoodWelcome", [
      { id: "r1", label: textOf("chatbotPage.tplFoodOpt1"), reply: info, finish: "end" },
      {
        id: "r2",
        label: textOf("chatbotPage.tplFoodOpt2"),
        asks: [
          { type: "text_input", variable: "pedido", prompt: textOf("chatbotPage.tplFoodAsk") },
          { type: "phone_input", variable: "telefone", prompt: phone },
        ],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplFoodOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "realestate") {
    return named(textOf, "chatbotPage.tplRealEstateName", "chatbotPage.tplRealEstateDesc", "chatbotPage.tplRealEstateWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplRealEstateOpt1"),
        asks: [{ type: "text_input", variable: "imovel", prompt: textOf("chatbotPage.tplRealEstateAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      {
        id: "r2",
        label: textOf("chatbotPage.tplRealEstateOpt2"),
        asks: [{ type: "text_input", variable: "aluguel", prompt: textOf("chatbotPage.tplRealEstateRentAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplRealEstateOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "education") {
    return named(textOf, "chatbotPage.tplEducationName", "chatbotPage.tplEducationDesc", "chatbotPage.tplEducationWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplEducationOpt1"),
        asks: [{ type: "text_input", variable: "curso", prompt: textOf("chatbotPage.tplEducationAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r2", label: textOf("chatbotPage.tplEducationOpt2"), reply: info, finish: "end" },
      { id: "r3", label: textOf("chatbotPage.tplEducationOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "beauty") {
    return named(textOf, "chatbotPage.tplBeautyName", "chatbotPage.tplBeautyDesc", "chatbotPage.tplBeautyWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplBeautyOpt1"),
        asks: [
          { type: "date_input", variable: "data", prompt: date },
          { type: "phone_input", variable: "telefone", prompt: phone },
        ],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r2", label: textOf("chatbotPage.tplBeautyOpt2"), reply: info, finish: "end" },
      { id: "r3", label: textOf("chatbotPage.tplBeautyOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "automotive") {
    return named(textOf, "chatbotPage.tplAutomotiveName", "chatbotPage.tplAutomotiveDesc", "chatbotPage.tplAutomotiveWelcome", [
      {
        id: "r1",
        label: textOf("chatbotPage.tplAutomotiveOpt1"),
        asks: [{ type: "text_input", variable: "servico", prompt: textOf("chatbotPage.tplAutomotiveAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      {
        id: "r2",
        label: textOf("chatbotPage.tplAutomotiveOpt2"),
        asks: [{ type: "date_input", variable: "data", prompt: date }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplAutomotiveOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "retail") {
    return named(textOf, "chatbotPage.tplRetailName", "chatbotPage.tplRetailDesc", "chatbotPage.tplRetailWelcome", [
      { id: "r1", label: textOf("chatbotPage.tplRetailOpt1"), reply: info, finish: "end" },
      {
        id: "r2",
        label: textOf("chatbotPage.tplRetailOpt2"),
        asks: [{ type: "text_input", variable: "pedido", prompt: textOf("chatbotPage.tplRetailAsk") }],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplRetailOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "travel") {
    return named(textOf, "chatbotPage.tplTravelName", "chatbotPage.tplTravelDesc", "chatbotPage.tplTravelWelcome", [
      { id: "r1", label: textOf("chatbotPage.tplTravelOpt1"), reply: info, finish: "end" },
      {
        id: "r2",
        label: textOf("chatbotPage.tplTravelOpt2"),
        asks: [
          { type: "text_input", variable: "viagem", prompt: textOf("chatbotPage.tplTravelAsk") },
          { type: "phone_input", variable: "telefone", prompt: phone },
        ],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplTravelOpt3"), finish: "handoff" },
    ]);
  }

  if (id === "fitness") {
    return named(textOf, "chatbotPage.tplFitnessName", "chatbotPage.tplFitnessDesc", "chatbotPage.tplFitnessWelcome", [
      { id: "r1", label: textOf("chatbotPage.tplFitnessOpt1"), reply: info, finish: "end" },
      {
        id: "r2",
        label: textOf("chatbotPage.tplFitnessOpt2"),
        asks: [
          { type: "date_input", variable: "data", prompt: date },
          { type: "phone_input", variable: "telefone", prompt: phone },
        ],
        reply: confirm,
        finish: "handoff",
      },
      { id: "r3", label: textOf("chatbotPage.tplFitnessOpt3"), finish: "handoff" },
    ]);
  }

  return named(textOf, "chatbotPage.tplEventsName", "chatbotPage.tplEventsDesc", "chatbotPage.tplEventsWelcome", [
    {
      id: "r1",
      label: textOf("chatbotPage.tplEventsOpt1"),
      asks: [{ type: "text_input", variable: "evento", prompt: textOf("chatbotPage.tplEventsAsk") }],
      reply: confirm,
      finish: "handoff",
    },
    {
      id: "r2",
      label: textOf("chatbotPage.tplEventsOpt2"),
      asks: [{ type: "date_input", variable: "data", prompt: date }],
      reply: confirm,
      finish: "handoff",
    },
    { id: "r3", label: textOf("chatbotPage.tplEventsOpt3"), finish: "handoff" },
  ]);
}
