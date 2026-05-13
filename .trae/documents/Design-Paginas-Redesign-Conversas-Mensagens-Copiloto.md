# Design de Páginas — Redesign Conversas e Mensagens
Abordagem: desktop-first, mantendo fluxos e capacidades atuais; refatorar apenas layout/IA visível.

## Tokens e estilos globais
- Layout: CSS Grid (páginas) + Flexbox (componentes).
- Breakpoints: base (<640), sm (≥640), lg (≥1024), xl (≥1280).
- Cores (conceito):
  - Fundo: claro “off-white”; escuro “ink-900”.
  - Primária/ação: brand-500 (hover brand-600).
  - Sucesso/estado: verde (OPEN), âmbar (PENDING), cinza (RESOLVED).
  - Bordas: ink-100/200 (claro) e ink-700/800 (escuro).
- Tipografia: título 24–28px/700; seções 14–16px/600; corpo 14px/400; metadados 12px.
- Componentes base:
  - Botões: primary (brand), secondary (neutro), ghost (mínimo), ícones com hit-area ≥ 40px.
  - Inputs: altura 40–44px; foco com ring brand.
  - Cards: radius 12–16px; sombra leve; hover com elevação sutil.

---

## Página: Conversas (/conversations)
### Meta Information
- Title: “Conversas”
- Description: “Lista de conversas do workspace com filtros por status, equipe e caixa.”
- OG: título + descrição; imagem padrão da marca.

### Page Structure
- Estrutura em coluna única com largura fluida e padding responsivo.
- Cabeçalho + barra de ações fixa no topo do conteúdo (não sticky global).

### Seções & Componentes
1. **Header**
   - Esquerda: Título “Conversas” + subtítulo.
   - Direita: 
     - Campo de busca (ícone de lupa, placeholder, aria-label).
     - Botão circular “Nova mensagem” (ícone lápis) abrindo modal.

2. **Alternância de escopo**
   - Dois botões em “segmented control”: “Organização” e “Minhas”.
   - Estado ativo com fundo brand e texto branco.

3. **Filtros**
   - Chips de status: Todas, Abertas, Pendentes, Resolvidas.
   - Linha de selects compactos: Equipe + Caixa (inbox), com ícones e labels sr-only.

4. **Estados de lista**
   - Loading: spinner central e skeleton opcional.
   - Vazio: card tracejado com ícone, texto e hint (varia conforme busca/escopo).

5. **Lista de cards**
   - Cada card: Grid 3 colunas (avatar | conteúdo | tempo).
   - Avatar: foto do contato ou inicial; badge de canal (ex.: WhatsApp) sobreposto.
   - Conteúdo:
     - Linha 1: nome + chip de status + chip de inbox.
     - Linha 2: preview da última mensagem (truncate).
     - Badges contextuais: aguardando handoff humano; atendimento por bot; lead type e valor (quando resolvida).
   - Ação: clique navega para /conversations/:id.

6. **Modais**
   - “Iniciar conversa” (seleção de contato).
   - “Mensagem rápida” para contato selecionado.

---

## Página: Detalhe da Conversa (/conversations/:id)
### Meta Information
- Title: “Conversa — {Nome do contato}”
- Description: “Histórico de mensagens, ações de status e contexto do contato.”
- OG: título + preview do contato (quando disponível).

### Page Structure (desktop-first)
- Grid em 2–3 colunas:
  - Coluna principal: histórico + composer.
  - Coluna direita 1: **CRM** (colapsável).
  - Coluna direita 2: **Copiloto** (somente quando habilitado).
- Em xl (≥1280): painéis laterais visíveis/colapsáveis.
- Em mobile/tablet: CRM e Copiloto abrem como drawers laterais.

### Seções & Componentes
1. **Top Bar / Header da conversa**
   - Botão “Voltar” + identificação do contato (nome, telefone) + chips (status/caixa).
   - Ações rápidas: alternar status (aberta/pendente), abrir modal de resolver, ações de transferência.
   - Indicadores: badges de bot/handoff humano quando aplicável.

2. **Viewport de mensagens**
   - Container com scroll próprio.
   - Bolhas agrupadas por direção (entrada/saída) e por “nota privada”.
   - Mensagens com mídia: preview (imagem) e link/ícone (arquivo).
   - Metadados: horários; status de envio/entrega/leitura (onde aplicável).

3. **Composer (barra inferior)**
   - Input multiline com expansão.
   - Controles:
     - Toggle de “nota privada”.
     - Emoji picker rápido.
     - Anexo (arquivo) e imagem.
     - Gravação de áudio (start/stop) + preview + enviar.
     - Templates (menu) + modal de envio.
   - Botão “Enviar” desabilita conforme regras (ex.: sem texto, gravando, enviando anexo, fora da janela quando não é nota privada).

4. **Painel CRM (direita)**
   - Cabeçalho com botão colapsar/expandir.
   - Conteúdo em cards:
     - Dados do contato (nome/telefone/email quando existir).
     - Notas do contato.
     - Tags (listar, adicionar, editar/remover conforme UI atual).
     - Pipeline/estágio (quando existir) e contexto de CRM.
   - Mobile: drawer com overlay; fecha por X e click fora.

5. **Copiloto (direita) — somente quando habilitado**
   - Regra de visibilidade:
     - Exibir apenas se `assistantAiEnabled=true` **e** (você é admin **ou** `aiPilotAccessEnabled=true`).
     - Se ficar desabilitado (incluindo retorno `ai_disabled`), **ocultar** botão e painel, e fechar se estiver aberto.
   - Desktop:
     - Botão flutuante (Sparkles) para abrir/fechar.
     - Painel com cabeçalho (título + fechar), comandos e área de resultado.
   - Conteúdo:
     - Cards de comando: “Resumir”, “Sugerir resposta”, “Avaliar conversa”.
     - Estado: loading com spinner; erros em caixa de alerta; resultados em cards (ex.: resumo, sentimento/intenções).
   - Mobile: drawer com overlay e mesmo conteúdo.

6. **Acessibilidade e interação**
   - Focus states consistentes (ring brand).
   - Hit areas de ícones ≥ 40px.
   - Teclas de atalho existentes devem continuar funcionando (ex.: alternar nota privada, anexos, resolver, navegar próxima/anterior).

---

## Nota de UX do redesign (sem mudar funcionalidades)
- Priorizar legibilidade do histórico (espaçamento, agrupamento, contraste) e reduzir ruído nos painéis laterais.
- Tornar “Copiloto desativado” um estado invisível: se não está disponível, ele não ocupa espaço nem cria affordances na UI.