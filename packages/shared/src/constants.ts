export const WHATSAPP_SESSION_WINDOW_HOURS = 24;

/** ID da organização criada na migração multi-tenant (dados legados). */
export const DEFAULT_ORGANIZATION_ID = "11111111-1111-1111-1111-111111111111";

export const DEFAULT_PIPELINE_STAGES = [
  { name: "Novo lead", order: 1, color: "#6366f1", probabilityPct: 10 },
  { name: "Em atendimento", order: 2, color: "#3b82f6", probabilityPct: 25 },
  { name: "Proposta enviada", order: 3, color: "#f59e0b", probabilityPct: 50 },
  { name: "Negociação", order: 4, color: "#8b5cf6", probabilityPct: 65 },
  { name: "Convertido", order: 5, color: "#10b981", probabilityPct: 100 },
  { name: "Aguardando retorno", order: 6, color: "#06b6d4", probabilityPct: 30 },
  { name: "Encerrado", order: 7, color: "#6b7280", probabilityPct: 0 },
] as const;

export const DEFAULT_TAGS = [
  { name: "Novo lead", color: "#6366f1" },
  { name: "Interessado", color: "#3b82f6" },
  { name: "Teste realizado", color: "#f59e0b" },
  { name: "Convertido", color: "#10b981" },
  { name: "Cancelado / churn", color: "#ef4444" },
] as const;

/** Tipos de lead padrão (pt-BR) — seed / migração. */
export const DEFAULT_LEAD_TYPES = [
  { name: "MQL — lead de marketing", color: "#6366f1", order: 0 },
  { name: "SQL — lead de vendas", color: "#3b82f6", order: 1 },
  { name: "Oportunidade", color: "#f59e0b", order: 2 },
  { name: "Fechado — ganho", color: "#10b981", order: 3 },
  { name: "Fechado — perdido", color: "#ef4444", order: 4 },
  { name: "Suporte / relacionamento", color: "#8b5cf6", order: 5 },
] as const;

export const BCRYPT_COST_FACTOR = 12;

export const JWT_EXPIRY = "24h";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const ALLOWED_MEDIA_TYPES = {
  image: ["image/jpeg", "image/png"],
  document: ["application/pdf"],
  audio: ["audio/mpeg", "audio/ogg"],
  video: ["video/mp4"],
} as const;
