import { prisma } from "../db.js";
import { callOpenAiCompatibleChat } from "./promptModulePreviewLlm.js";
import { getAssistOpenAiCredentialsForOrganization } from "./agentAssistLlm.js";
import type { CrmFlowContext } from "./crmFlowContext.js";

const HOT_KEYWORDS = ["urgente", "comprar", "fechar", "orçamento", "proposta", "hoje", "agora"];
const COLD_KEYWORDS = ["só pesquisando", "talvez", "depois", "não tenho interesse", "cancelar"];

function keywordLeadTemperature(text: string): "quente" | "morno" | "frio" {
  const lower = text.toLowerCase();
  if (HOT_KEYWORDS.some((k) => lower.includes(k))) return "quente";
  if (COLD_KEYWORDS.some((k) => lower.includes(k))) return "frio";
  return "morno";
}

function keywordInterest(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("telefon") || lower.includes("pabx") || lower.includes("voip")) return "Telefonia";
  if (lower.includes("whatsapp") || lower.includes("mensagem")) return "WhatsApp";
  if (lower.includes("suporte") || lower.includes("problema")) return "Suporte";
  if (lower.includes("financeiro") || lower.includes("pagamento")) return "Financeiro";
  if (lower.includes("crm") || lower.includes("vendas")) return "CRM";
  return "Geral";
}

async function llmClassifyTemperature(text: string, organizationId: string): Promise<string | null> {
  const settings = await prisma.settings.findUnique({
    where: { organizationId },
    select: { assistantAiEnabled: true },
  });
  if (settings?.assistantAiEnabled === false) return null;
  const creds = await getAssistOpenAiCredentialsForOrganization(organizationId);
  if (!creds) return null;
  try {
    const { text: reply } = await callOpenAiCompatibleChat({
      baseUrl: creds.baseUrl,
      apiKey: creds.apiKey,
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 16,
      system: "Classifique o lead como quente, morno ou frio. Responda apenas uma palavra.",
      history: [],
      userMessage: text.slice(0, 2000),
    });
    return reply.trim().toLowerCase();
  } catch {
    return null;
  }
}

export async function runCrmAiClassifyBlock(
  organizationId: string,
  mode: string,
  ctx: CrmFlowContext,
): Promise<CrmFlowContext> {
  const text = [ctx.nome, ctx.body, ctx.message, ctx.notes, ctx.tags].filter(Boolean).join(" ");

  if (mode === "lead_temperature") {
    let temp = keywordLeadTemperature(text);
    const llm = await llmClassifyTemperature(text, organizationId);
    if (llm) {
      if (llm.includes("quente")) temp = "quente";
      else if (llm.includes("frio")) temp = "frio";
      else if (llm.includes("morno")) temp = "morno";
    }
    return { ...ctx, leadTemperature: temp, classificacao: temp };
  }

  if (mode === "detect_interest") {
    const interest = keywordInterest(text);
    return { ...ctx, detectedInterest: interest, interesse: interest };
  }

  if (mode === "summarize_conversation") {
    const summary = text.slice(0, 500);
    return { ...ctx, conversationSummary: summary, resumo: summary };
  }

  return ctx;
}
