import type { HelpArticle } from "../types";

export const glossaryArticles: HelpArticle[] = [
  {
    id: "glossary-index",
    slug: "glossary",
    title: "Glossário",
    description: "Termos usados na plataforma.",
    categoryId: "glossary",
    keywords: ["glossário", "termo", "definição", "dicionário"],
    level: "basic",
    readMinutes: 6,
    blocks: [
      { type: "heading", id: "terms", level: 2, text: "Termos" },
      {
        type: "list",
        items: [
          "Bot — ponto de automação ligado a um canal; pode usar webhook ou agente nativo.",
          "Agente — perfil de IA com prompts, ferramentas e base de conhecimento.",
          "Prompt — instruções textuais que guiam o comportamento do agente.",
          "Tool / Ferramenta — integração HTTP que o agente pode invocar.",
          "Webhook — URL que recebe eventos HTTP da plataforma.",
          "RAG — recuperação de trechos da base de conhecimento para enriquecer respostas.",
          "EIL — camada que valida ações do agente com políticas e facts.",
          "Lead — contato em processo comercial no funil.",
          "Deal / Negócio — oportunidade com valor e produtos associados.",
          "Pipeline / Funil — etapas pelas quais leads avançam.",
          "Follow-up — contato automatizado após condição ou tempo.",
          "Template — modelo de mensagem, often exigido em WhatsApp proativo.",
          "Flow / Fluxo — automação com gatilho, condição e ação.",
          "Inbox / Caixa de entrada — agrupamento lógico de conversas por canal ou equipe.",
          "Contexto — histórico e memória disponibilizados ao agente por turno.",
        ],
      },
    ],
  },
];
