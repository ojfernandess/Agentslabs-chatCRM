import type { HelpArticle } from "../types";

export const gettingStartedArticles: HelpArticle[] = [
  {
    id: "platform-overview",
    slug: "getting-started/platform-overview",
    title: "Visão geral da plataforma",
    description: "Entenda a estrutura do menu, papéis de usuário e fluxo básico de atendimento.",
    categoryId: "getting-started",
    keywords: ["início", "painel", "dashboard", "navegação", "menu", "plataforma"],
    level: "basic",
    readMinutes: 4,
    routeContext: ["/"],
    relatedSlugs: ["getting-started/configure-organization", "conversations/overview"],
    blocks: [
      { type: "heading", id: "what-is", level: 2, text: "O que é a plataforma?" },
      {
        type: "paragraph",
        text: "A plataforma reúne atendimento omnichannel, CRM, campanhas, automação com agentes de IA e relatórios em um único lugar. Cada organização possui seus próprios contatos, conversas, bots e configurações.",
      },
      { type: "heading", id: "menu", level: 2, text: "Menu principal" },
      {
        type: "list",
        items: [
          "Painel — indicadores rápidos do dia a dia.",
          "Relatórios — métricas de conversas e desempenho.",
          "IA & Insights — análises assistidas por inteligência artificial.",
          "Conversas — inbox de atendimento (WhatsApp, e-mail e outros canais).",
          "Contatos — cadastro e gestão de pessoas.",
          "Funil CRM — pipeline visual de leads (quando habilitado).",
          "Negócios — oportunidades com valor e produtos (quando habilitado).",
          "Lembretes — tarefas e follow-ups pendentes.",
        ],
      },
      {
        type: "callout",
        variant: "admin",
        text: "Administradores também veem: Caixas de entrada, Auditoria, Bots, Campanhas e Automação.",
      },
      { type: "heading", id: "roles", level: 2, text: "Papéis de usuário" },
      {
        type: "list",
        items: [
          "Agente — atende conversas, consulta contatos e CRM conforme permissões.",
          "Administrador — configura canais, bots, automação, equipe e integrações.",
        ],
      },
      {
        type: "callout",
        variant: "tip",
        text: "Use Meu atendimento para ver conversas e negócios atribuídos a você.",
      },
    ],
  },
  {
    id: "configure-organization",
    slug: "getting-started/configure-organization",
    title: "Configurar a organização",
    description: "Passos iniciais para canais, aparência, equipe e notificações.",
    categoryId: "getting-started",
    keywords: ["configuração", "organização", "setup", "início", "settings"],
    level: "basic",
    readMinutes: 5,
    requiresAdmin: true,
    routeContext: ["/settings"],
    relatedSlugs: ["settings/channel", "settings/team", "bots/create"],
    blocks: [
      { type: "heading", id: "access", level: 2, text: "Como acessar" },
      {
        type: "steps",
        steps: [
          { title: "Abra o menu do perfil", body: "Clique no seu avatar no canto inferior do menu lateral." },
          { title: "Selecione Configurações", body: "Disponível apenas para administradores." },
          { title: "Escolha a aba desejada", body: "Canal, Aparência, Equipe, CRM, etc." },
        ],
      },
      { type: "heading", id: "priority", level: 2, text: "Ordem recomendada" },
      {
        type: "list",
        ordered: true,
        items: [
          "Canal — conecte WhatsApp ou outros provedores.",
          "Caixas de entrada — crie inboxes por canal ou equipe.",
          "Equipe — convide usuários e defina papéis.",
          "Aparência — logo e tema das conversas.",
          "CRM — tipos de lead e categorias de negócio (se aplicável).",
        ],
      },
      {
        type: "callout",
        variant: "important",
        text: "Sem canal configurado, conversas não chegam à plataforma. Configure o canal antes de criar bots.",
      },
    ],
  },
];
