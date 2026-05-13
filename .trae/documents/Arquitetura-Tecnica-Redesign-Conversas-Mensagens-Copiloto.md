## 1.Architecture design
```mermaid
graph TD
  A["Navegador do usuário"] --> B["Aplicação Web React"]
  B --> C["API HTTP (Fastify)"]
  C --> D["Prisma ORM"]
  D --> E["Banco PostgreSQL"]
  C --> F["Redis / BullMQ (jobs)"]
  C --> G["Provedores WhatsApp (Meta/360dialog/Twilio/Evolution)"]
  C --> H["LLM (OpenAI compatível) - Assistente/Copiloto"]

  subgraph "Frontend"
    B
  end

  subgraph "Backend"
    C
    D
  end

  subgraph "Dados"
    E
    F
  end

  subgraph "Serviços Externos"
    G
    H
  end
```

## 2.Technology Description
- Frontend: React@18 + react-router-dom + tailwindcss + vite
- Backend: Fastify@5 + Zod (validação) + Prisma@6
- Database: PostgreSQL
- Assíncrono/Filas: BullMQ@5 + Redis (ioredis)
- Integrações: WhatsApp providers (dependendo da configuração do tenant) + LLM (via chave configurada no settings)

## 3.Route definitions
| Route | Purpose |
|-------|---------|
| /conversations | Lista de conversas (filtros, busca local, iniciar conversa) |
| /conversations/:id | Tela de detalhe: histórico + composer + ações + CRM + Copiloto (se habilitado) |
| /ai-insights | Página administrativa/operacional para insights e toggles de IA/piloto |

## 4.API definitions (If it includes backend services)
### 4.1 Core API
Conversas
- `GET /conversations?status&teamId&inboxId&mine&pageSize` (listagem)
- `GET /conversations/:id` (detalhe com contato, mensagens, timeline)
- `POST /conversations/:id/read` (marcar como lida)
- `POST /conversations/:id/insights` (Copiloto: resumo/insights/avaliação)

Configurações relacionadas ao Copiloto
- `GET /settings/pilot` (retorna flags mínimas para UI)
- `PUT /settings` (admin: atualizar `assistantAiEnabled` e `aiPilotAccessEnabled`)

TypeScript types (contratos principais)
```ts
type PilotFlags = {
  assistantAiEnabled: boolean;
  aiPilotAccessEnabled: boolean;
};

type CopilotInsights = {
  summary: string;
  intent: string;
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  suggestedActions: string[];
  conversionOutlook: string;
  alerts: string[];
};

type ConversationListItem = {
  id: string;
  status: "OPEN" | "PENDING" | "RESOLVED";
  updatedAt: string;
  awaitingHumanHandoff?: boolean;
  agentBotTriageActive?: boolean;
  closureValue?: number | null;
  contact: { id: string; name: string; phone: string; profilePictureUrl?: string | null };
  assignedTo: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  inbox?: { id: string; name: string; isDefault: boolean; channelType?: string } | null;
  leadType: { id: string; name: string; color: string } | null;
  messages: { body: string | null; direction: string; createdAt: string }[];
};
```

Comportamento de “ocultar Copiloto quando desativado” (impacto arquitetural)
- A UI decide exibir Copiloto a partir de `GET /settings/pilot` + papel do usuário (admin ou flag `aiPilotAccessEnabled`).
- Se a API de insights responder com erro de código `ai_disabled`, a UI deve tratar como “IA desativada” e ocultar/fechar o Copiloto.

## 5.Server architecture diagram (If it includes backend services)
```mermaid
graph TD
  A["React Client"] --> B["Rotas Fastify"]
  B --> C["Middleware Auth/JWT"]
  B --> D["Services (Conversas/Mensagens/Copiloto)"]
  D --> E["Repos/Prisma"]
  E --> F["PostgreSQL"]
  D --> G["Integração LLM"]

  subgraph "Server"
    B
    C
    D
    E
  end
```

## 6.Data model(if applicable)
### 6.1 Data model definition
```mermaid
erDiagram
  ORGANIZATION ||--o{ SETTINGS : has
  ORGANIZATION ||--o{ INBOX : owns
  INBOX ||--o{ CONVERSATION : contains
  CONTACT ||--o{ CONVERSATION : participates
  CONVERSATION ||--o{ MESSAGE : has

  SETTINGS {
    string organizationId
    boolean assistantAiEnabled
    boolean aiPilotAccessEnabled
  }

  CONVERSATION {
    string id
    string organizationId
    string inboxId
    string contactId
    string status
    string assignedToId
    string teamId
    float closureValue
    string closureReason
  }

  MESSAGE {
    string id
    string conversationId
    string direction
    string type
    string body
    string mediaUrl
    boolean isPrivate
    string status
    string createdAt
  }
```

### 6.2 Data Definition Language
(DDL já existe no schema/migrations do projeto; não é necessária alteração para este redesign, pois o escopo é UI/UX e comportamento de exibição do Copiloto.)