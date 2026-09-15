import type { HelpArticle } from "../types";

export const contactsArticles: HelpArticle[] = [
  {
    id: "contacts-overview",
    slug: "contacts/overview",
    title: "Contatos",
    description: "Cadastro, busca, tags e etapas do funil.",
    categoryId: "contacts",
    keywords: ["contato", "cliente", "cadastro", "pessoa"],
    level: "basic",
    readMinutes: 4,
    routeContext: ["/contacts"],
    relatedSlugs: ["contacts/tags", "crm/overview"],
    blocks: [
      { type: "heading", id: "what", level: 2, text: "O que são?" },
      {
        type: "paragraph",
        text: "Contatos centralizam pessoas que interagem com sua organização — telefone, e-mail, tags, etapa do CRM e histórico de conversas.",
      },
      { type: "heading", id: "list", level: 2, text: "Lista e paginação" },
      {
        type: "paragraph",
        text: "A página Contatos lista registros com paginação (50 por página). Use busca e filtros para localizar clientes.",
      },
    ],
  },
  {
    id: "contacts-tags",
    slug: "contacts/tags",
    title: "Tags e etapas",
    description: "Organize contatos com tags e mova entre etapas do funil.",
    categoryId: "contacts",
    keywords: ["tag", "etapa", "segmento", "organizar"],
    level: "basic",
    readMinutes: 4,
    relatedSlugs: ["campaigns/create", "settings/tags"],
    blocks: [
      { type: "heading", id: "tags", level: 2, text: "Tags" },
      {
        type: "paragraph",
        text: "Tags classificam contatos para campanhas e automações. Adicione na ficha do contato ou em massa na lista.",
      },
      { type: "heading", id: "stages", level: 2, text: "Etapas" },
      {
        type: "paragraph",
        text: "Use +Etapa na lista para mover contato no funil CRM sem abrir o kanban.",
      },
      {
        type: "callout",
        variant: "admin",
        text: "Administradores podem excluir contatos em massa selecionando checkboxes na lista.",
      },
    ],
  },
];
