# Roadmap: Paridade Chatbot ↔ Typebot

## Estado atual (baseline)
- 13 blocos: start, end, text, image, text_input, choice_input, condition, set_variable, webhook, add_tag, handoff, wait, jump
- Editor React Flow, publicação, ligação a bot WhatsApp
- ~25% paridade de blocos Typebot, ~30% plataforma

## Fase 1 — WhatsApp + editor (prioridade alta) ✅ concluída
| ID | Item | Estado |
|----|------|--------|
| 1.1 | UI blocos existentes | ✅ Tag picker, webhook método/resposta, condition `neq`, choice modo botões |
| 1.2 | Botões WhatsApp nativos | ✅ Meta interactive + parse webhook |
| 1.3 | Wait real | ✅ `waitingInput.kind=wait` + scheduler 30s |
| 1.4 | Simulador | ✅ API `test-chat` + `ChatbotFlowSimulator` |
| 1.5 | Variáveis de fluxo | ✅ Editor no hub + PATCH variables |

## Fase 2 — Bubbles e inputs
| ID | Item |
|----|------|
| 2.1 | video, audio bubbles |
| 2.2 | email, number, phone inputs com validação |
| 2.3 | date, rating inputs |

## Fase 3 — Logic e integrações
| ID | Item |
|----|------|
| 3.1 | AB test |
| 3.2 | redirect, script |
| 3.3 | OpenAI block (opcional) |
| 3.4 | export/import JSON |

## Fase 4 — Plataforma
| ID | Item |
|----|------|
| 4.1 | Embed / API publicId |
| 4.2 | Theme UI |
| 4.3 | Analytics de resultados |
| 4.4 | Events (invalid reply, commands) |
