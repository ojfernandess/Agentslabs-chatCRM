# Design de Páginas — Responsividade (Desktop-first)

## Padrões Globais
- Breakpoints (3 faixas): Mobile 0–639px; Tablet 640–1023px; Desktop ≥1024px.
- Layout responsivo: desktop-first; reduzir densidade e colapsar navegação conforme viewport.
- Áreas mínimas de toque: mínimo 44×44px (preferido 48×48px); espaçamento mínimo 8px entre alvos; inputs e selects com min-height 44px; ícones clicáveis sempre com padding.
- Estados e acessibilidade: focus visível (usar `.ds-focus`), hover não obrigatório em mobile; garantir `aria-label` em ícones.
- Tipografia: evitar textos <12px em mobile; usar truncamento com tooltip/expansão quando necessário.

## Estilos/Design Tokens (baseado no CSS atual)
- Background: `bg-ink-50` (dark: `bg-ink-950`)
- Superfícies: `.card-surface` (bordas/contraste preservados)
- Botões: `.btn-primary`, `.btn-secondary`, `.btn-ghost` com padding suficiente para toque
- Inputs: `.input-field` com min-height 44px em mobile/tablet

## Página: Shell do App (Layout + Navegação)
- Layout: Desktop: `aside` fixo ~256px + `main` flex (como hoje). Tablet: sidebar pode permanecer, mas com densidade menor (labels truncados, se necessário). Mobile: sidebar vira drawer off-canvas; `main` ocupa 100%.
- Estrutura:
  - Topo (mobile/tablet): barra superior com botão de menu (hambúrguer), título da seção e ações principais (ex.: sino).
  - Sidebar (drawer no mobile): itens com min-height 44px; badges clicáveis não devem competir com o link.
  - Conteúdo: `main` rolável; evitar `h-screen` que quebre com teclado virtual (priorizar `min-h` e `overflow` consistente).

## Páginas Públicas
### Login (/login)
- Estrutura: card central em desktop; em mobile, ocupar largura com padding 16–20px e botões full-width.
- Componentes: inputs empilhados; mensagens de erro abaixo do campo; CTA primário com min-height 44px.

### Reset de senha (/login/reset)
- Igual ao Login, com foco em legibilidade e CTA destacado.

### Docs (/docs)
- Estrutura: coluna de leitura (max-width) + padding; em mobile, navegação/âncoras colapsáveis.

### CSAT (/csat/:token)
- Estrutura: formulário linear; componentes de nota/rating com alvos grandes e espaçamento 8–12px.

## Páginas do App (padrões reutilizáveis)
### Padrão A — Página de Lista (ex.: /conversations, /contacts, /teams, /inboxes, /bots, /automation, /broadcasts, /reminders)
- Desktop: tabela/grid com colunas completas.
- Tablet: reduzir colunas secundárias; manter ações em menu (kebab) se existirem.
- Mobile: preferir “cards empilhados” com 2–4 linhas de info; ações primárias em botões tocáveis; filtros em drawer/accordion.

### Padrão B — Página de Detalhe (ex.: /conversations/:id, /contacts/:id, /settings, /profile, /my-attendance, /conversation-audit)
- Desktop: 2 colunas (conteúdo + painel lateral) quando aplicável.
- Tablet: 1–2 colunas conforme espaço.
- Mobile: 1 coluna; painéis laterais viram seções empilhadas; tabs viram dropdown/scroll horizontal com alvos 44px.

### Padrão C — Analytics (ex.: /reports, /ai-insights, Dashboard)
- Gráficos: responsivos ao container; legendas colapsáveis; tooltips tocáveis.
- Cards: 1 col (mobile), 2 (tablet), 3–4 (desktop), sem alterar visual dos componentes.

### Padrão D — Kanban (ex.: /crm, /deals)
- Desktop: múltiplas colunas visíveis.
- Tablet/Mobile: scroll horizontal intencional nas colunas (com snap suave); cards com área tocável e espaçamento consistente.

## Página: Super Admin (/super)
- Mesmos padrões de Lista/Detalhe; priorizar legibilidade e navegação segura em mobile (sem truncar ações críticas).
