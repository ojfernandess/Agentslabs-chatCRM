import type { HelpArticle } from "../types";

export const conversationsArticles: HelpArticle[] = [
  {
    id: "conversations-overview",
    slug: "conversations/overview",
    title: "Conversas e atendimento",
    description: "Lista, filtros, estados e fluxo de atendimento humano.",
    categoryId: "conversations",
    keywords: ["conversa", "inbox", "atendimento", "chat", "whatsapp"],
    level: "basic",
    readMinutes: 5,
    routeContext: ["/conversations"],
    relatedSlugs: ["conversations/first-conversation", "conversations/assign-close"],
    blocks: [
      { type: "heading", id: "list", level: 2, text: "Lista de conversas" },
      {
        type: "paragraph",
        text: "Conversas agrupa threads de todos os canais conectados. Use filtros por status (Abertas, Pendentes, Resolvidas), equipe ou caixa de entrada.",
      },
      { type: "heading", id: "states", level: 2, text: "Estados" },
      {
        type: "list",
        items: [
          "OPEN — em atendimento ativo.",
          "PENDING — aguardando cliente ou ação interna.",
          "RESOLVED — encerrada; pode reabrir se o cliente responder.",
        ],
      },
      { type: "heading", id: "shortcuts", level: 2, text: "Atalhos úteis" },
      {
        type: "list",
        items: [
          "Filtros por equipe — links no menu lateral em Times.",
          "Caixas de entrada — atalhos por inbox configurada.",
          "E-mail — workspace dedicado em inboxes de canal EMAIL.",
        ],
      },
    ],
  },
  {
    id: "conversations-first",
    slug: "conversations/first-conversation",
    title: "Primeiro atendimento",
    description: "Como responder, usar respostas prontas e registrar informações.",
    categoryId: "conversations",
    keywords: ["primeiro atendimento", "responder", "mensagem"],
    level: "basic",
    readMinutes: 4,
    relatedSlugs: ["conversations/assign-close", "contacts/overview"],
    blocks: [
      { type: "heading", id: "steps", level: 2, text: "Passo a passo" },
      {
        type: "steps",
        steps: [
          { title: "Abra Conversas", body: "Selecione uma conversa aberta na lista." },
          { title: "Leia o histórico", body: "Mensagens do cliente, bot e colegas." },
          { title: "Responda", body: "Digite na caixa inferior ou use resposta pronta (se configurada)." },
          { title: "Atualize o contato", body: "Tags, tipo de lead ou notas no painel lateral." },
          { title: "Encerre quando concluir", body: "Altere status para Resolvida conforme workflow." },
        ],
      },
    ],
  },
  {
    id: "conversations-assign",
    slug: "conversations/assign-close",
    title: "Atribuição, transferência e encerramento",
    description: "Como atribuir responsável, transferir entre equipes e fechar conversas.",
    categoryId: "conversations",
    keywords: ["atribuir", "transferir", "encerrar", "resolver", "fechar"],
    level: "basic",
    readMinutes: 5,
    routeContext: ["/conversations"],
    relatedSlugs: ["crm/overview", "deals/create"],
    blocks: [
      { type: "heading", id: "assign", level: 2, text: "Atribuição" },
      {
        type: "paragraph",
        text: "Atribua a conversa a você ou a outro atendente para organizar fila e responsabilidade.",
      },
      { type: "heading", id: "transfer", level: 2, text: "Transferência" },
      {
        type: "paragraph",
        text: "Transfira para outra equipe quando o assunto mudar de departamento. Membros da equipe destino recebem notificação.",
      },
      { type: "heading", id: "close", level: 2, text: "Encerramento" },
      {
        type: "paragraph",
        text: "Ao resolver, informe tipo de lead, valor estimado ou crie negócio conforme regras de workflow da organização.",
      },
      {
        type: "callout",
        variant: "tip",
        text: "Configure regras de encerramento em Configurações → Workflow para padronizar campos obrigatórios.",
      },
    ],
  },
];
