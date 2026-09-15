import type { HelpArticle } from "../types";

export const analyticsArticles: HelpArticle[] = [
  {
    id: "analytics-dashboard",
    slug: "analytics/dashboard",
    title: "Painel e Relatórios",
    description: "Indicadores do dia e relatórios detalhados.",
    categoryId: "analytics",
    keywords: ["painel", "dashboard", "relatório", "métrica", "kpi"],
    level: "basic",
    readMinutes: 4,
    routeContext: ["/", "/reports"],
    relatedSlugs: ["analytics/ai-insights"],
    blocks: [
      { type: "heading", id: "dashboard", level: 2, text: "Painel" },
      {
        type: "paragraph",
        text: "O Painel resume volume de conversas, tempos e indicadores do dia. Use como primeiro olhar ao iniciar o expediente.",
      },
      { type: "heading", id: "reports", level: 2, text: "Relatórios" },
      {
        type: "paragraph",
        text: "Relatórios oferece filtros por período, atendente e canal para análise histórica e exportação.",
      },
      {
        type: "callout",
        variant: "tip",
        text: "Compare semanas equivalentes para identificar tendências sazonais.",
      },
    ],
  },
  {
    id: "analytics-ai",
    slug: "analytics/ai-insights",
    title: "IA & Insights",
    description: "Análises assistidas por inteligência artificial.",
    categoryId: "analytics",
    keywords: ["ia", "insights", "inteligência", "análise"],
    level: "intermediate",
    readMinutes: 4,
    routeContext: ["/ai-insights"],
    blocks: [
      {
        type: "paragraph",
        text: "IA & Insights agrega padrões de conversas, temas recorrentes e sugestões. Consulte quando quiser entender motivos de contato ou qualidade do atendimento em escala.",
      },
    ],
  },
];
