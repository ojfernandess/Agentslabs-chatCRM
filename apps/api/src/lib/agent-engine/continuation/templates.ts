/** Template exemplo: Passo 8 Auda após check-in HTTP 200 (qualquer segmento pode adaptar). */
export const AUDA_POST_CHECKIN_PASSO8_RULE = {
  id: "post_checkin_passo8",
  name: "Passo 8 — detalhes da estadia após check-in",
  enabled: true,
  trigger: "after_reply" as const,
  when: {
    toolCalled: "audaar_check_in",
    toolOk: true,
    resultDelivered: true,
  },
  delaySeconds: 4,
  maxPerConversation: 1,
  turnHint:
    "[Continuação automática — Passo 8] O check-in foi concluído com sucesso no turno anterior. " +
    "Use os dados da reserva já presentes no contexto (flowSlots / memória — localizador, datas, hóspede). " +
    "Execute Passo 8: até 4× buscar_conhecimento (endereço, entrada, wifi, políticas) e envie a mensagem completa de conclusão ao hóspede. " +
    "NÃO chame audaar_consultar_reserva nem audaar_check_in neste turno. NÃO transfira para humano.",
};

export const DEFAULT_AGENT_CONTINUATION_TEMPLATES = {
  auda_post_checkin_passo8: {
    enabled: true,
    rules: [AUDA_POST_CHECKIN_PASSO8_RULE],
  },
} as const;

export type AgentContinuationTemplateId = keyof typeof DEFAULT_AGENT_CONTINUATION_TEMPLATES;

export function getAgentContinuationTemplate(
  templateId: string,
): (typeof DEFAULT_AGENT_CONTINUATION_TEMPLATES)[AgentContinuationTemplateId] | null {
  if (templateId in DEFAULT_AGENT_CONTINUATION_TEMPLATES) {
    return DEFAULT_AGENT_CONTINUATION_TEMPLATES[templateId as AgentContinuationTemplateId];
  }
  return null;
}
