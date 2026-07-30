/** Configuração em `behaviorConfig.knowledgeSearchSkip`. */
export type KnowledgeSearchSkipConfig = {
  /** Omitir RAG proactivo e `buscar_conhecimento` em confirmações curtas / cadastro. Default activo. */
  enabled: boolean;
  /** Instrução injectada quando a KB é omitida. Vazio = texto padrão do sistema. */
  instruction: string;
};

export const DEFAULT_KNOWLEDGE_SEARCH_SKIP_HINT =
  "A mensagem do cliente é confirmação, dado de cadastro, check-in/verificar reserva ou continuação de fluxo — **não** invoque `buscar_conhecimento` nem responda com factos da base de conhecimento. Continue o fluxo operacional (API / check-in) em curso; no C3 use o **Modelo S1** só com o JSON da tool de reserva.";

const DEFAULT_KNOWLEDGE_SEARCH_SKIP_CONFIG: KnowledgeSearchSkipConfig = {
  enabled: true,
  instruction: "",
};

export function parseKnowledgeSearchSkipFromBehavior(behaviorConfig: unknown): KnowledgeSearchSkipConfig {
  if (!behaviorConfig || typeof behaviorConfig !== "object") {
    return { ...DEFAULT_KNOWLEDGE_SEARCH_SKIP_CONFIG };
  }
  const raw = (behaviorConfig as Record<string, unknown>).knowledgeSearchSkip;
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_KNOWLEDGE_SEARCH_SKIP_CONFIG };
  }
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled !== false,
    instruction: typeof o.instruction === "string" ? o.instruction.trim().slice(0, 2000) : "",
  };
}

export function buildKnowledgeSearchSkipHint(cfg: KnowledgeSearchSkipConfig): string {
  const body = cfg.instruction.trim() || DEFAULT_KNOWLEDGE_SEARCH_SKIP_HINT;
  return `\n\n[OpenConduit — base de conhecimento omitida neste turno]\n${body}\n`;
}
