# Design de Páginas — Hub de Tarefas/Agenda (Lembretes)

## Diretrizes globais (desktop-first)
- **Layout**: Grid de 12 colunas + Flexbox para barras e toolbars. Largura máx. de conteúdo ~1200–1360px; sidebar opcional 280–320px.
- **Breakpoints**: Desktop (>=1200), Tablet (768–1199), Mobile (<768). No mobile: sidebar vira drawer; toolbar quebra em 2 linhas.
- **Tokens**
  - Background: #0B0F1A (dark) ou #FFFFFF (light), mantendo tema existente do produto.
  - Surface (cards): var(--surface-1), borda 1px var(--border).
  - Accent primário: var(--primary). Estados: hover +8% luminosidade; disabled 40% opacidade.
  - Tipografia: base 14–16px; headings 20/24/28px.
- **Interações**: transições 150–200ms (opacity/transform). Drag-and-drop com “ghost” e highlight de dropzone.

---

## Página: Hub de Tarefas/Agenda (Lembretes)

### Meta Information
- Title: "Lembretes — Hub de Tarefas e Agenda"
- Description: "Gerencie tarefas em Lista, Kanban, Agenda e Calendário. Planeje com IA e conecte às conversas."
- OG: og:title, og:description, og:type="website"

### Page Structure
Padrão “dashboard”: topo fixo + (sidebar opcional) + área principal com toolbar e view container.

### Seções & Componentes
1. **Top App Bar (global)**
   - Esquerda: nome do produto + breadcrumb curto (ex.: "Lembretes").
   - Direita: busca global (se existente), avatar/menu.

2. **Header do Hub (primeira dobra)**
   - Título: "Lembretes" (mantido) + subtítulo pequeno "Hub de Tarefas/Agenda".
   - Botão primário: **“Nova tarefa”**.
   - Ação secundária: **“IA Planner”**.

3. **Toolbar de visualização (sempre visível abaixo do header)**
   - **Segmented control**: Lista | Kanban | Agenda | Calendário.
   - Filtros compactos: Status (dropdown), Intervalo de datas (picker), botão “Limpar”.
   - Estado: ao alternar modo, manter filtros e seleção.

4. **Criação rápida (compatibilidade com fluxo existente)**
   - Input inline (ex.: “Adicionar lembrete…”) com Enter para criar.
   - Parsing leve opcional de data/hora digitada (sem depender de IA).

5. **Container de Modo (área principal)**
   - **Modo Lista**: tabela/lista em cards
     - Linha/card: checkbox (concluir), título, data/hora, status chip, ícone de conversa (se vinculado).
     - Ações no hover: editar, mover status, abrir conversa.
   - **Modo Kanban**: 3 colunas (Todo/Doing/Done)
     - Card: título + data; drag-and-drop entre colunas.
   - **Modo Agenda**: grade dia/semana
     - Blocos com hora (quando existir startAt); itens sem hora ficam em seção “Sem horário”.
   - **Modo Calendário**: mês/semana
     - Dia mostra contagem + itens; clique abre lista do dia e CTA “Adicionar”.

6. **Painel lateral / Modal de Detalhe (para todos os modos)**
   - Abre ao clicar em item.
   - Campos: título (input), notas (textarea), status, data/hora (start/due), vínculo com conversa (link + botão “Ir para conversa”).
   - Rodapé: Salvar, Cancelar, Excluir.

7. **Painel IA Planner (drawer/modal)**
   - Campo principal: textarea “Descreva seu plano (ex.: tarefas e prazos)”.
   - Contexto: timezone (auto), semana alvo (picker), opcional “vincular a conversa atual”.
   - Saída: lista proposta de tarefas com datas/horários sugeridos.
   - Controles: “Aplicar plano” (com confirmação), “Editar proposta”, “Descartar”.

8. **Estados**
   - Loading: skeleton no container do modo.
   - Empty: ilustração/placeholder + CTA “Criar primeira tarefa”.
   - Error: banner inline com retry.

---

## Página: Conversa (existente) — extensão para tarefas

### Meta Information
- Title: "Conversa"
- Description: "Converse e crie tarefas vinculadas ao contexto."

### Seções & Componentes (adicionais)
1. **Ação ‘Criar tarefa’ por mensagem**
   - No menu da mensagem: “Criar tarefa”.
   - Pré-preenche título com trecho selecionado; permite definir data e status.

2. **Widget ‘Tarefas da conversa’ (lado direito no desktop; abaixo no mobile)**
   - Lista curta: Abertas primeiro, Concluídas colapsadas.
   - Cada item: status + título + data; clique abre o detalhe no Hub.

3. **Navegação de contexto**
   - Ao abrir tarefa pelo widget, manter “Voltar para conversa” no painel de detalhe.
