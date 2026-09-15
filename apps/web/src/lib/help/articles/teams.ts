import type { HelpArticle } from "../types";

export const teamsArticles: HelpArticle[] = [
  {
    id: "teams-overview",
    slug: "teams/overview",
    title: "Times e colaboração",
    description: "Equipes, transferências e hub de colaboração.",
    categoryId: "teams",
    keywords: ["time", "equipe", "team", "colaboração", "transferência"],
    level: "basic",
    readMinutes: 4,
    routeContext: ["/teams"],
    relatedSlugs: ["conversations/assign-close"],
    blocks: [
      { type: "heading", id: "what", level: 2, text: "O que são Times?" },
      {
        type: "paragraph",
        text: "Times agrupam atendentes por departamento ou especialidade. Conversas podem ser filtradas e transferidas por equipe.",
      },
      { type: "heading", id: "hub", level: 2, text: "Hub de colaboração" },
      {
        type: "paragraph",
        text: "Funcionalidades avançadas (canais internos, workspace, copilot) dependem de feature flags habilitadas pelo super administrador.",
      },
    ],
  },
];
