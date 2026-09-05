export type LegalSlug = "terms" | "privacy" | "usage-rights" | "features" | "about" | "help";

export type LegalSection = {
  heading?: string;
  paragraphs: string[];
  bullets?: string[];
};

export type LegalDocument = {
  title: string;
  updatedAt: string;
  sections: LegalSection[];
};

const UPDATED = "2026-09-05";

const documentsPt: Record<LegalSlug, LegalDocument> = {
  about: {
    title: "Sobre o OpenNexo CRM",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "O OpenNexo CRM é uma plataforma de atendimento omnicanal e gestão comercial desenvolvida pela AgentsLabs, destinada a equipas de vendas, suporte e operações que precisam centralizar conversas, contactos e processos num único ambiente.",
          "A solução integra canais de mensagens, automação assistida por IA, CRM e ferramentas de produtividade para agentes, respeitando as configurações e políticas definidas por cada organização cliente.",
        ],
      },
    ],
  },
  features: {
    title: "Funcionalidades da plataforma",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "Lista não exaustiva das capacidades disponíveis na plataforma. A activação de módulos depende do plano, permissões e feature flags configurados pelo administrador da organização.",
        ],
      },
      {
        heading: "Atendimento e conversas",
        bullets: [
          "Caixa de conversas omnicanal com histórico unificado por contacto",
          "WhatsApp, e-mail, widget web e outros canais configuráveis por caixa de entrada",
          "Atribuição manual e automática de conversas a agentes e equipas",
          "Prioridades, etiquetas, notas internas e transferência entre equipas",
          "Respostas rápidas, modelos de mensagem e anexos multimédia",
          "Pesquisa de satisfação (CSAT) após encerramento",
          "Auditoria de conversas para administradores",
        ],
      },
      {
        heading: "CRM e contactos",
        bullets: [
          "Gestão de contactos com campos, etiquetas e histórico de interacções",
          "Funil comercial (Kanban) e etapas de pipeline configuráveis",
          "Oportunidades e negócios (deals) com valores e fecho comercial",
          "Lembretes, tarefas e follow-ups",
          "Importação e segmentação de contactos para campanhas",
        ],
      },
      {
        heading: "Inteligência artificial",
        bullets: [
          "Copiloto de atendimento com sugestões de resposta e resumo de conversas",
          "Agentes conversacionais nativos com base de conhecimento (RAG)",
          "Etiquetagem inteligente de conversas e contactos",
          "Centro de memória por contacto com preferências e contexto persistente",
          "Insights de IA e métricas de qualidade de atendimento",
        ],
      },
      {
        heading: "Automação e integrações",
        bullets: [
          "Bots personalizados com webhooks e perfis de automação",
          "Fluxos CRM e regras de encaminhamento",
          "Campanhas de difusão (broadcast) segmentadas",
          "API REST documentada e webhooks para integrações externas",
          "Integrações de telefonia e voz (conforme activação)",
          "Sincronização com calendário Google (conforme activação)",
        ],
      },
      {
        heading: "Equipas e administração",
        bullets: [
          "Painel operacional, relatórios e métricas de desempenho",
          "Gestão de utilizadores, funções (agente/administrador) e convites",
          "Configuração de caixas de entrada, canais e horários",
          "Feature flags e personalização por organização (multi-tenant)",
          "Espaço colaborativo de equipas (conforme activação)",
        ],
      },
      {
        paragraphs: [
          "Esta lista descreve funcionalidades de produto em nível comercial. Não expõe credenciais, chaves de API, endpoints internos, dados de clientes ou detalhes de infraestrutura.",
        ],
      },
    ],
  },
  terms: {
    title: "Termos de Uso",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "Estes Termos de Uso regulam o acesso e utilização do OpenNexo CRM («Plataforma»), software disponibilizado pela AgentsLabs («Fornecedor») a organizações clientes («Organização») e aos seus utilizadores autorizados («Utilizador»).",
          "Ao aceder à Plataforma, o Utilizador declara ter lido, compreendido e aceite estes Termos. Se não concordar, não deve utilizar o serviço.",
        ],
      },
      {
        heading: "1. Objeto e elegibilidade",
        bullets: [
          "A Plataforma destina-se a uso profissional B2B para gestão de atendimento, CRM e automação.",
          "O acesso é concedido mediante credenciais fornecidas ou aprovadas pela Organização.",
          "O Utilizador deve ser maior de idade e possuir capacidade legal para contratar, ou actuar em nome da Organização.",
        ],
      },
      {
        heading: "2. Conta e segurança",
        bullets: [
          "O Utilizador é responsável pela confidencialidade das suas credenciais e por todas as acções realizadas na sua conta.",
          "Deve notificar imediatamente o administrador da Organização em caso de uso não autorizado.",
          "É proibido partilhar contas pessoais ou contornar controlos de acesso.",
        ],
      },
      {
        heading: "3. Uso permitido e proibido",
        bullets: [
          "Permitido: utilizar a Plataforma para atendimento, vendas e operações legítimas da Organização, em conformidade com a lei aplicável.",
          "Proibido: uso fraudulento, spam, violação de direitos de terceiros, engenharia reversa, sobrecarga intencional, scraping não autorizado, ou qualquer actividade que comprometa a segurança ou disponibilidade do serviço.",
          "Conteúdos processados por funcionalidades de IA devem ser revistos por humanos quando relevante para decisões com impacto legal ou comercial.",
        ],
      },
      {
        heading: "4. Dados e responsabilidades",
        bullets: [
          "A Organização é responsável pelos dados de contactos e conversas que introduz ou recebe na Plataforma, incluindo obter bases legais adequadas (ex.: LGPD/GDPR).",
          "A AgentsLabs actua como fornecedora de tecnologia; o tratamento de dados pessoais de clientes finais é co-responsabilizado conforme contrato com a Organização e a Política de Privacidade.",
        ],
      },
      {
        heading: "5. Disponibilidade e alterações",
        bullets: [
          "O Fornecedor procura manter a Plataforma disponível, podendo ocorrer manutenções programadas ou interrupções por motivos de força maior.",
          "Funcionalidades podem evoluir; alterações materiais a estes Termos serão comunicadas por meios razoáveis.",
        ],
      },
      {
        heading: "6. Limitação de responsabilidade",
        paragraphs: [
          "Na máxima extensão permitida por lei, a AgentsLabs não se responsabiliza por danos indirectos, lucros cessantes ou perda de dados resultantes de uso indevido, integrações de terceiros ou indisponibilidade temporária, salvo disposição legal imperativa ou acordo escrito em contrário.",
        ],
      },
      {
        heading: "7. Lei aplicável",
        paragraphs: [
          "Estes Termos regem-se pela legislação brasileira, salvo acordo diverso entre a Organização e a AgentsLabs. Foro competente: comarca da sede da AgentsLabs, com renúncia a qualquer outro, salvo direitos do consumidor quando aplicável.",
        ],
      },
    ],
  },
  privacy: {
    title: "Política de Privacidade",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "Esta Política descreve como o OpenNexo CRM, operado pela AgentsLabs, trata dados pessoais no contexto da plataforma CRM, em alinhamento com boas práticas de mercado (LGPD — Lei n.º 13.709/2018 — e, quando aplicável, GDPR).",
        ],
      },
      {
        heading: "1. Papéis no tratamento",
        bullets: [
          "Organização cliente: em regra, controladora dos dados dos seus contactos, leads e clientes finais.",
          "AgentsLabs: operadora/fornecedora de tecnologia que processa dados em nome da Organização, conforme instruções contratuais e configurações da conta.",
          "Utilizadores (agentes/administradores): dados de conta profissional (nome, e-mail, função) tratados para autenticação e operação.",
        ],
      },
      {
        heading: "2. Categorias de dados tratados",
        bullets: [
          "Dados de identificação e contacto: nome, telefone, e-mail, identificadores de canal.",
          "Conteúdo de conversas, metadados de mensagens, etiquetas, notas e histórico de atendimento.",
          "Dados comerciais: pipeline, negócios, lembretes e interacções CRM.",
          "Dados técnicos: registos de acesso, endereço IP, dispositivo, cookies de sessão e logs de auditoria.",
          "Dados processados por IA: apenas quando activados pela Organização, para sugestões, classificação e memória contextual.",
        ],
      },
      {
        heading: "3. Finalidades e bases legais",
        bullets: [
          "Prestação do serviço contratado (execução de contrato).",
          "Segurança, prevenção de fraude e cumprimento de obrigações legais (obrigação legal/legítimo interesse).",
          "Melhoria do produto e suporte técnico, com minimização de dados (legítimo interesse).",
          "Funcionalidades de IA opt-in configuradas pela Organização (consentimento ou legítimo interesse, conforme o caso).",
        ],
      },
      {
        heading: "4. Partilha e subprocessadores",
        paragraphs: [
          "Dados podem ser processados por infraestrutura cloud, serviços de e-mail transacional, provedores de IA e integrações activadas pela Organização (ex.: WhatsApp, telefonia). A AgentsLabs exige contratos e medidas de segurança compatíveis com o nível de risco.",
        ],
      },
      {
        heading: "5. Retenção e segurança",
        bullets: [
          "Os dados são conservados enquanto durar a relação contratual e conforme políticas de retenção da Organização.",
          "Após rescisão, dados podem ser eliminados ou exportados conforme acordo comercial.",
          "Medidas técnicas incluem encriptação em trânsito, controlo de acesso por função, isolamento multi-tenant e registos de auditoria.",
        ],
      },
      {
        heading: "6. Direitos dos titulares",
        bullets: [
          "Contactos e clientes finais devem exercer direitos (acesso, rectificação, eliminação, portabilidade, oposição) junto da Organização controladora.",
          "Utilizadores da plataforma podem solicitar actualização ou eliminação da conta ao administrador da Organização.",
          "Pedidos à AgentsLabs relacionados com operação da plataforma podem ser enviados para privacidade@agentslabs.cloud, indicando a Organização associada.",
        ],
      },
      {
        heading: "7. Transferências internacionais",
        paragraphs: [
          "Quando serviços de subprocessadores estiverem localizados fora do Brasil/EEE, serão adoptadas salvaguardas contratuais adequadas (cláusulas padrão ou mecanismos equivalentes).",
        ],
      },
    ],
  },
  "usage-rights": {
    title: "Direitos de Uso",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "Este documento define os direitos de propriedade intelectual e licenciamento do software OpenNexo CRM.",
        ],
      },
      {
        heading: "1. Propriedade intelectual",
        bullets: [
          "O software, marca, interface, documentação e componentes proprietários são de titularidade exclusiva da AgentsLabs ou dos seus licenciadores.",
          "Todos os direitos não expressamente concedidos são reservados à AgentsLabs.",
        ],
      },
      {
        heading: "2. Licença de uso",
        bullets: [
          "É concedida à Organização uma licença limitada, não exclusiva, intransferível e revogável para utilizar a Plataforma conforme o plano contratado.",
          "Utilizadores autorizados podem aceder apenas dentro dos limites da sua função (agente, administrador, etc.).",
        ],
      },
      {
        heading: "3. Dados do cliente",
        bullets: [
          "A Organização mantém a titularidade sobre os dados comerciais e de contactos que insere na Plataforma.",
          "A AgentsLabs não reivindica propriedade sobre conteúdos de conversas ou bases de contactos da Organização.",
        ],
      },
      {
        heading: "4. Restrições",
        bullets: [
          "É proibida a cópia, modificação, distribuição, sublicenciamento ou criação de obras derivadas do software, salvo autorização escrita.",
          "É proibida a descompilação ou engenharia reversa, excepto quando permitido imperativamente por lei.",
          "É proibido remover avisos de direitos de autor ou marcas registadas.",
        ],
      },
      {
        heading: "5. Feedback",
        paragraphs: [
          "Sugestões ou feedback enviados à AgentsLabs podem ser utilizados para melhorar o produto, sem obrigação de compensação, salvo acordo em contrário.",
        ],
      },
      {
        heading: "6. Reserva de direitos",
        paragraphs: [
          "© AgentsLabs. OpenNexo CRM e logótipos associados são marcas ou marcas registadas da AgentsLabs ou parceiros licenciadores. Todos os direitos reservados.",
        ],
      },
    ],
  },
  help: {
    title: "Central de Ajuda",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "O OpenNexo CRM é disponibilizado à sua organização mediante contrato ou convite do administrador. Para questões operacionais, utilize os canais abaixo.",
        ],
      },
      {
        heading: "Suporte à organização",
        bullets: [
          "Problemas de acesso, permissões ou configuração: contacte o administrador da sua organização na plataforma.",
          "Recuperação de palavra-passe: utilize «Esqueci a palavra-passe» na página de login.",
          "Novos utilizadores: solicite convite ao administrador — não há registo público autónomo.",
        ],
      },
      {
        heading: "Suporte AgentsLabs",
        bullets: [
          "Organizações com contrato de suporte devem utilizar o canal acordado comercialmente.",
          "Questões de privacidade: privacidade@agentslabs.cloud",
          "Site: agentslabs.cloud",
        ],
      },
    ],
  },
};

const documentsEn: Record<LegalSlug, LegalDocument> = {
  about: {
    title: "About OpenNexo CRM",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "OpenNexo CRM is an omnichannel service and commercial management platform developed by AgentsLabs for sales, support, and operations teams that need to centralize conversations, contacts, and processes in one place.",
          "The solution integrates messaging channels, AI-assisted automation, CRM, and agent productivity tools, respecting settings and policies defined by each customer organization.",
        ],
      },
    ],
  },
  features: {
    title: "Platform features",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "Non-exhaustive list of platform capabilities. Module activation depends on plan, permissions, and feature flags configured by the organization administrator.",
        ],
      },
      {
        heading: "Service & conversations",
        bullets: [
          "Omnichannel inbox with unified history per contact",
          "WhatsApp, email, web widget, and other channels configurable per inbox",
          "Manual and automatic conversation assignment to agents and teams",
          "Priorities, tags, internal notes, and team transfers",
          "Canned responses, message templates, and media attachments",
          "CSAT surveys after closure",
          "Conversation audit for administrators",
        ],
      },
      {
        heading: "CRM & contacts",
        bullets: [
          "Contact management with fields, tags, and interaction history",
          "Commercial funnel (Kanban) with configurable pipeline stages",
          "Deals and opportunities with values and closure tracking",
          "Reminders, tasks, and follow-ups",
          "Contact import and segmentation for campaigns",
        ],
      },
      {
        heading: "Artificial intelligence",
        bullets: [
          "Service copilot with reply suggestions and conversation summaries",
          "Native conversational agents with knowledge base (RAG)",
          "Intelligent conversation and contact tagging",
          "Memory center per contact with preferences and persistent context",
          "AI insights and service quality metrics",
        ],
      },
      {
        heading: "Automation & integrations",
        bullets: [
          "Custom bots with webhooks and automation profiles",
          "CRM flows and routing rules",
          "Segmented broadcast campaigns",
          "Documented REST API and webhooks for external integrations",
          "Telephony and voice integrations (when enabled)",
          "Google Calendar sync (when enabled)",
        ],
      },
      {
        heading: "Teams & administration",
        bullets: [
          "Operational dashboard, reports, and performance metrics",
          "User management, roles (agent/admin), and invites",
          "Inbox, channel, and business hours configuration",
          "Feature flags and per-organization customization (multi-tenant)",
          "Team collaboration workspace (when enabled)",
        ],
      },
      {
        paragraphs: [
          "This list describes product capabilities at a commercial level. It does not expose credentials, API keys, internal endpoints, customer data, or infrastructure details.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Use",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "These Terms of Use govern access to and use of OpenNexo CRM (the «Platform»), software provided by AgentsLabs (the «Provider») to customer organizations (the «Organization») and their authorized users (the «User»).",
          "By accessing the Platform, the User declares having read, understood, and accepted these Terms. If you do not agree, do not use the service.",
        ],
      },
      {
        heading: "1. Purpose and eligibility",
        bullets: [
          "The Platform is intended for professional B2B use for service, CRM, and automation.",
          "Access is granted through credentials provided or approved by the Organization.",
          "The User must be of legal age and have legal capacity, or act on behalf of the Organization.",
        ],
      },
      {
        heading: "2. Account and security",
        bullets: [
          "The User is responsible for credential confidentiality and all actions under their account.",
          "Unauthorized use must be reported immediately to the Organization administrator.",
          "Sharing personal accounts or bypassing access controls is prohibited.",
        ],
      },
      {
        heading: "3. Permitted and prohibited use",
        bullets: [
          "Permitted: use the Platform for legitimate Organization operations in compliance with applicable law.",
          "Prohibited: fraud, spam, violation of third-party rights, reverse engineering, intentional overload, unauthorized scraping, or any activity compromising security or availability.",
          "AI-processed content should be reviewed by humans when relevant for legal or commercial decisions.",
        ],
      },
      {
        heading: "4. Data and responsibilities",
        bullets: [
          "The Organization is responsible for contact and conversation data it introduces or receives, including obtaining adequate legal bases (e.g., LGPD/GDPR).",
          "AgentsLabs acts as a technology provider; processing of end-customer personal data is shared per contract with the Organization and the Privacy Policy.",
        ],
      },
      {
        heading: "5. Availability and changes",
        bullets: [
          "The Provider aims to keep the Platform available; scheduled maintenance or force majeure interruptions may occur.",
          "Features may evolve; material changes to these Terms will be communicated by reasonable means.",
        ],
      },
      {
        heading: "6. Limitation of liability",
        paragraphs: [
          "To the maximum extent permitted by law, AgentsLabs is not liable for indirect damages, lost profits, or data loss resulting from misuse, third-party integrations, or temporary unavailability, except where mandatory law or written agreement provides otherwise.",
        ],
      },
      {
        heading: "7. Governing law",
        paragraphs: [
          "These Terms are governed by Brazilian law, unless otherwise agreed between the Organization and AgentsLabs.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "This Policy describes how OpenNexo CRM, operated by AgentsLabs, processes personal data in the CRM platform context, aligned with market best practices (LGPD and, where applicable, GDPR).",
        ],
      },
      {
        heading: "1. Roles in processing",
        bullets: [
          "Customer Organization: generally controller of its contacts, leads, and end-customer data.",
          "AgentsLabs: technology processor handling data on behalf of the Organization per contractual instructions and account settings.",
          "Users (agents/admins): professional account data (name, email, role) processed for authentication and operation.",
        ],
      },
      {
        heading: "2. Data categories",
        bullets: [
          "Identification and contact data: name, phone, email, channel identifiers.",
          "Conversation content, message metadata, tags, notes, and service history.",
          "Commercial data: pipeline, deals, reminders, and CRM interactions.",
          "Technical data: access logs, IP address, device, session cookies, and audit logs.",
          "AI-processed data: only when enabled by the Organization for suggestions, classification, and contextual memory.",
        ],
      },
      {
        heading: "3. Purposes and legal bases",
        bullets: [
          "Service delivery under contract.",
          "Security, fraud prevention, and legal compliance.",
          "Product improvement and technical support with data minimization.",
          "Opt-in AI features configured by the Organization.",
        ],
      },
      {
        heading: "4. Sharing and subprocessors",
        paragraphs: [
          "Data may be processed by cloud infrastructure, transactional email, AI providers, and integrations enabled by the Organization. AgentsLabs requires contracts and security measures commensurate with risk.",
        ],
      },
      {
        heading: "5. Retention and security",
        bullets: [
          "Data is retained for the contractual relationship and per Organization retention policies.",
          "After termination, data may be deleted or exported per commercial agreement.",
          "Technical measures include encryption in transit, role-based access, multi-tenant isolation, and audit logs.",
        ],
      },
      {
        heading: "6. Data subject rights",
        bullets: [
          "End contacts should exercise rights (access, rectification, deletion, portability, objection) with the controlling Organization.",
          "Platform users may request account updates or deletion from their Organization administrator.",
          "AgentsLabs platform operation requests: privacidade@agentslabs.cloud, indicating the associated Organization.",
        ],
      },
      {
        heading: "7. International transfers",
        paragraphs: [
          "When subprocessor services are located outside Brazil/EEA, appropriate contractual safeguards will be adopted.",
        ],
      },
    ],
  },
  "usage-rights": {
    title: "Usage Rights",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "This document defines intellectual property and licensing rights for OpenNexo CRM software.",
        ],
      },
      {
        heading: "1. Intellectual property",
        bullets: [
          "Software, brand, interface, documentation, and proprietary components are the exclusive property of AgentsLabs or its licensors.",
          "All rights not expressly granted are reserved to AgentsLabs.",
        ],
      },
      {
        heading: "2. License",
        bullets: [
          "The Organization receives a limited, non-exclusive, non-transferable, revocable license to use the Platform per contracted plan.",
          "Authorized users may access only within their role limits (agent, administrator, etc.).",
        ],
      },
      {
        heading: "3. Customer data",
        bullets: [
          "The Organization retains ownership of commercial and contact data it enters into the Platform.",
          "AgentsLabs does not claim ownership over Organization conversation content or contact databases.",
        ],
      },
      {
        heading: "4. Restrictions",
        bullets: [
          "Copying, modifying, distributing, sublicensing, or creating derivative works is prohibited without written authorization.",
          "Decompilation or reverse engineering is prohibited except where imperatively permitted by law.",
          "Removing copyright notices or trademarks is prohibited.",
        ],
      },
      {
        heading: "5. Feedback",
        paragraphs: [
          "Suggestions or feedback sent to AgentsLabs may be used to improve the product without compensation obligation, unless otherwise agreed.",
        ],
      },
      {
        heading: "6. Rights reserved",
        paragraphs: [
          "© AgentsLabs. OpenNexo CRM and associated logos are trademarks of AgentsLabs or licensed partners. All rights reserved.",
        ],
      },
    ],
  },
  help: {
    title: "Help Center",
    updatedAt: UPDATED,
    sections: [
      {
        paragraphs: [
          "OpenNexo CRM is provided to your organization through contract or administrator invite. For operational questions, use the channels below.",
        ],
      },
      {
        heading: "Organization support",
        bullets: [
          "Access, permissions, or configuration issues: contact your organization administrator.",
          "Password recovery: use «Forgot password» on the login page.",
          "New users: request an invite from an administrator — there is no standalone public signup.",
        ],
      },
      {
        heading: "AgentsLabs support",
        bullets: [
          "Organizations with a support contract should use the commercially agreed channel.",
          "Privacy questions: privacidade@agentslabs.cloud",
          "Website: agentslabs.cloud",
        ],
      },
    ],
  },
};

export const LEGAL_SLUGS: LegalSlug[] = [
  "about",
  "features",
  "terms",
  "privacy",
  "usage-rights",
  "help",
];

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as string[]).includes(value);
}

export function getLegalDocument(slug: LegalSlug, locale: string): LegalDocument {
  const useEn = locale.startsWith("en");
  const pack = useEn ? documentsEn : documentsPt;
  return pack[slug];
}
