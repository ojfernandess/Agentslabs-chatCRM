## Objetivo
Implementar responsividade completa no web app mantendo o design e as funcionalidades.

## Breakpoints (regras do projeto)
- Mobile: 320px–768px
- Tablet: 769px–1024px
- Desktop: 1025px+

Mapeamento para Tailwind (limites efetivos usados no código):
- Mobile: `base` (0–639) + `sm` (640–767)
- Tablet: `md` (768–1023)
- Desktop: `lg` (1024+)

## Regras globais aplicadas
- Mídia responsiva: `img` e `video` com `max-width: 100%` e `height: auto`.
- Touch targets (dispositivos touch): `button`, `input`, `select`, `textarea` com `min-height: 44px` sob `@media (pointer: coarse)`.
- Navegação: itens principais com altura mínima 44px.

## Alterações realizadas (por arquivo)
- `apps/web/src/index.css`
  - Mídia responsiva (img/video).
  - Regra de touch target mínimo 44px em dispositivos touch.

- `apps/web/src/components/Layout.tsx`
  - Sidebar: mantém comportamento no desktop.
  - Mobile/Tablet: adiciona topbar e menu lateral em drawer (off-canvas) sem alterar conteúdo.
  - Itens de navegação com `min-h-11` (44px).

- `apps/web/src/i18n/messages.ts`
  - Adiciona `common.openMenu` (pt-BR/en) para acessibilidade do botão de menu.

- `apps/web/src/pages/*`
  - Padding responsivo em páginas principais: `p-4 sm:p-6 lg:p-8`.
  - Ajustes pontuais de botões de ícone para `h-11 w-11`.
  - Otimizações simples de imagem: `loading="lazy"` + `decoding="async"` onde aplicável.

- `apps/web/vite.config.ts`
  - Split de bundles via `manualChunks` (react, icons, charts, motion, dates) para melhorar cache e carregamento em rede lenta.

## Checklist de QA (manual)
- Layout
  - Mobile: menu abre/fecha, overlay fecha ao toque, navegação fecha ao trocar de rota.
  - Tablet: navegação utilizável, sem overflow horizontal.
  - Desktop: sidebar fixa como antes.

- Touch targets
  - Botões e inputs com altura mínima 44px em iOS/Android.

- Performance (heurística)
  - Imagens não críticas carregam com `loading="lazy"`.
  - Bundles divididos em chunks menores para carregamento paralelo em HTTP/2.
  - Evitar layout shift perceptível em listas/detalhes.

## Testes recomendados
- iOS Safari (iPhone + iPad)
- Android Chrome
- Android Firefox

Observação: a validação de tempo de carregamento (3s em 3G) deve ser verificada com DevTools (Network throttling) no ambiente real de deploy.
