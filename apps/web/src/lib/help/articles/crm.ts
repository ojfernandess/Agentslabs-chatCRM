import type { HelpArticle } from "../types";

export const crmArticles: HelpArticle[] = [
  {
    id: "crm-overview",
    slug: "crm/overview",
    title: "CRM — visão geral",
    description: "Funil kanban, contatos no pipeline e relação com negócios.",
    categoryId: "crm",
    keywords: ["crm", "funil", "kanban", "pipeline", "lead"],
    level: "basic",
    readMinutes: 4,
    featureFlag: "crm_kanban",
    routeContext: ["/crm"],
    relatedSlugs: ["crm/configure", "deals/overview"],
    blocks: [
      { type: "heading", id: "what", level: 2, text: "O que é?" },
      {
        type: "paragraph",
        text: "O Funil CRM exibe contatos organizados por etapas do pipeline. Arraste cards entre colunas conforme o lead avança na jornada comercial.",
      },
      { type: "heading", id: "when", level: 2, text: "Quando usar?" },
      {
        type: "list",
        items: [
          "Visualizar volume por etapa.",
          "Priorizar follow-up de leads parados.",
          "Sincronizar com tipos de lead e tags.",
        ],
      },
    ],
  },
  {
    id: "crm-configure",
    slug: "crm/configure",
    title: "Configurar CRM",
    description: "Etapas do funil, tipos de lead e categorias de negócio.",
    categoryId: "crm",
    keywords: ["configurar crm", "etapa", "tipo de lead", "pipeline"],
    level: "intermediate",
    readMinutes: 5,
    featureFlag: "crm_kanban",
    requiresAdmin: true,
    routeContext: ["/settings"],
    relatedSlugs: ["settings/crm", "deals/categories"],
    blocks: [
      { type: "heading", id: "steps", level: 2, text: "Configuração" },
      {
        type: "steps",
        steps: [
          { title: "Configurações → CRM", body: "Ajuste tipos de lead e opções do funil." },
          { title: "Etapas", body: "Nomeie colunas do kanban conforme seu processo." },
          { title: "Tipos de lead", body: "Classifique origem ou perfil comercial." },
          { title: "Negócios (se habilitado)", body: "Configure categorias e campos personalizados." },
        ],
      },
      {
        type: "callout",
        variant: "admin",
        text: "Somente administradores alteram estrutura do CRM.",
      },
    ],
  },
];
