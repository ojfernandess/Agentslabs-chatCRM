# Roadmap: Paridade Chatbot ↔ Typebot

## Estado atual (baseline)
- Roadmap Typebot **concluído** (Fases 1–4): 25 blocos, editor, WhatsApp, embed, analytics

## Fase 1 — WhatsApp + editor (prioridade alta) ✅ concluída
| ID | Item | Estado |
|----|------|--------|
| 1.1 | UI blocos existentes | ✅ Tag picker, webhook método/resposta, condition `neq`, choice modo botões |
| 1.2 | Botões WhatsApp nativos | ✅ Meta interactive + parse webhook |
| 1.3 | Wait real | ✅ `waitingInput.kind=wait` + scheduler 30s |
| 1.4 | Simulador | ✅ API `test-chat` + `ChatbotFlowSimulator` |
| 1.5 | Variáveis de fluxo | ✅ Editor no hub + PATCH variables |

## Fase 2 — Bubbles e inputs ✅ concluída
| ID | Item | Estado |
|----|------|--------|
| 2.1 | video, audio bubbles | ✅ `sendBotMedia` + editor |
| 2.2 | email, number, phone inputs com validação | ✅ API `validateChatbotUserInput` + executor/simulador |
| 2.3 | date, rating inputs | ✅ |

## Fase 3 — Logic e integrações ✅ concluída
| ID | Item | Estado |
|----|------|--------|
| 3.1 | AB test | ✅ Ramo ponderado + alças a/b/c no editor |
| 3.2 | redirect, script | ✅ Link WhatsApp + atribuições nome=valor |
| 3.3 | OpenAI block (opcional) | ✅ Chave org/servidor, variável + envio opcional |
| 3.4 | export/import JSON | ✅ GET export + POST import + UI |

## Fase 4 — Plataforma ✅ concluída
| ID | Item | Estado |
|----|------|--------|
| 4.1 | Embed / API publicId | ✅ `/chatbot/:publicId` + API pública CORS |
| 4.2 | Theme UI | ✅ Editor de cores + cabeçalho |
| 4.3 | Analytics de resultados | ✅ Sessões, conclusão, inválidas (7d) |
| 4.4 | Events (invalid reply, commands) | ✅ Template {{error}} + saltos por comando |
