import { prisma } from "../db.js";
import { config } from "../config.js";
import { callOpenAiCompatibleChat } from "./promptModulePreviewLlm.js";
import { contentHasMarkdownSections, chunkMarkdownSections } from "./knowledgeMarkdownChunking.js";
import {
  loadOrgKnowledgeStore,
} from "./agent-engine/knowledge/knowledgeOrgRepository.js";
import {
  parseKnowledgeEngineConfig,
  shouldUseKnowledgeEngineRuntime,
} from "./agent-engine/knowledge/parseKnowledgeEngineConfig.js";
import type { KnowledgeProviderKind } from "./agent-engine/knowledge/knowledgeEngineTypes.js";

export type RagOptimizeResult = {
  content: string;
  provider: KnowledgeProviderKind;
  sectionsBefore: number;
  sectionsAfter: number;
  factsPreserved: boolean;
  missingFacts: string[];
  model: string;
};

/** Extrai «impressões digitais» de factos para validar que nada crítico desapareceu. */
export function extractFactFingerprints(text: string): string[] {
  const fingerprints = new Set<string>();
  const normalized = text.replace(/\r\n/g, "\n");

  for (const m of normalized.matchAll(/https?:\/\/[^\s)>]+/gi)) {
    fingerprints.add(m[0].toLowerCase());
  }
  for (const m of normalized.matchAll(/[\w.+-]+@[\w.-]+\.\w+/gi)) {
    fingerprints.add(m[0].toLowerCase());
  }
  for (const m of normalized.matchAll(/R\$\s*[\d.,]+/gi)) {
    fingerprints.add(m[0].replace(/\s+/g, " "));
  }
  for (const m of normalized.matchAll(/\*\*[^*]{2,48}\*\*:\s*[^\n]+/g)) {
    fingerprints.add(m[0].trim().slice(0, 160));
  }
  for (const m of normalized.matchAll(/^#{2,3}\s+.+$/gm)) {
    fingerprints.add(m[0].trim().toLowerCase());
  }
  for (const m of normalized.matchAll(/^-\s+.{8,220}$/gm)) {
    fingerprints.add(m[0].trim().slice(0, 180));
  }

  return [...fingerprints].filter((f) => f.length >= 4);
}

export function validateFactPreservation(
  before: string,
  after: string,
): { ok: boolean; missing: string[] } {
  const beforeF = extractFactFingerprints(before);
  if (beforeF.length === 0) return { ok: true, missing: [] };
  const afterNorm = after.toLowerCase();
  const afterHeaders = [...after.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim().toLowerCase());
  const missing: string[] = [];

  for (const fp of beforeF) {
    const probe = fp
      .replace(/\*\*/g, "")
      .replace(/^#{1,6}\s+/, "")
      .trim()
      .toLowerCase();
    const token = probe.slice(0, Math.min(48, probe.length));
    if (token.length < 4) continue;

    if (/^#{1,6}\s/.test(fp.trim())) {
      const headingKey = probe.split("/")[0]?.trim() ?? probe;
      const headerHit =
        headingKey.length >= 4 &&
        afterHeaders.some((h) => h.includes(headingKey) || headingKey.includes(h.split("/")[0]?.trim() ?? h));
      if (headerHit) continue;
    }

    const valueProbe = probe.includes(":") ? (probe.split(":").pop()?.trim() ?? probe) : probe;
    if (valueProbe.length >= 4 && afterNorm.includes(valueProbe)) continue;
    if (afterNorm.includes(token)) continue;

    missing.push(fp.slice(0, 120));
  }

  const maxMissing = Math.max(1, Math.floor(beforeF.length * 0.12));
  return { ok: missing.length <= maxMissing, missing: missing.slice(0, 15) };
}

function countMarkdownSections(content: string): number {
  const matches = content.match(/^#{2,3}\s+\S+/gm);
  return matches?.length ?? 0;
}

function stripLlmMarkdownWrapper(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  }
  return t;
}

function buildOptimizeSystemPrompt(provider: KnowledgeProviderKind, locale: string): string {
  const isPt = locale.toLowerCase().startsWith("pt");
  const engineLabel = provider === "llamaindex" ? "LlamaIndex (semântico + secções)" : "OpenConduit (semântico + lexical)";

  return (
    (isPt
      ? `És um especialista em bases de conhecimento para RAG (${engineLabel}). Reestrutura documentos em Markdown optimizado para recuperação por embeddings e busca híbrida.`
      : `You are a RAG knowledge-base specialist (${engineLabel}). Restructure documents into Markdown optimized for embedding retrieval and hybrid search.`) +
    "\n\n" +
    (isPt
      ? `Regras OBRIGATÓRIAS:
1. NÃO inventes, omitas nem alteres factos (preços, horários, SSIDs, senhas, moradas, políticas, nomes, URLs, e-mails, capacidades, m²).
2. Mantém TODA a informação do documento original — só reorganiza e clarifica.
3. Usa \`# Título principal\` e secções \`## Tópico\` (WiFi, Quartos, Estacionamento, Check-in, Cancelamento, Políticas, etc.).
4. Cada secção \`##\` deve ser autocontida (ideal para chunking): título descritivo + bullets com factos.
5. Subsecções \`###\` para categorias (tipos de quarto, planos, produtos).
6. Listas com \`-\` para dados factuais; **rótulo:** valor para pares chave-valor (Rede, Senha, Endereço…).
7. Inclui sinónimos de busca nos títulos quando natural (ex.: «WiFi / Internet», «Quartos / Acomodações»).
8. Remove redundância verbal, mas NUNCA apagues dados.
9. Responde APENAS com o Markdown final — sem comentários, preâmbulo ou \`\`\` fences.`
      : `MANDATORY rules:
1. Do NOT invent, omit, or change facts (prices, hours, SSIDs, passwords, addresses, policies, names, URLs, emails, capacity, m²).
2. Keep ALL information from the source — only reorganize and clarify.
3. Use \`# Main title\` and \`## Topic\` sections (WiFi, Rooms, Parking, Check-in, Cancellation, Policies, etc.).
4. Each \`##\` section must be self-contained (chunk-friendly): descriptive title + bullet facts.
5. Use \`###\` for subcategories (room types, plans, products).
6. Use \`-\` lists for facts; **label:** value for key-value pairs.
7. Include search synonyms in titles when natural (e.g. «WiFi / Internet», «Rooms / Accommodation»).
8. Remove verbal redundancy but NEVER delete data.
9. Reply with ONLY the final Markdown — no commentary, preamble, or \`\`\` fences.`) +
    (provider === "llamaindex"
      ? isPt
        ? "\n\nOptimização LlamaIndex: secções de 400–1200 caracteres; evite secções gigantes; prefira um tópico por ##."
        : "\n\nLlamaIndex tuning: sections ~400–1200 chars; avoid huge sections; one topic per ##."
      : isPt
        ? "\n\nOptimização OpenConduit: títulos ## com palavras-chave que hóspedes/clientes usam nas perguntas; factos em bullets explícitos."
        : "\n\nOpenConduit tuning: ## headers with keywords users ask; explicit bullet facts.")
  );
}

export async function resolveRagProviderForDocumentOptimize(
  organizationId: string,
  botId?: string,
  explicit?: KnowledgeProviderKind,
): Promise<KnowledgeProviderKind> {
  if (explicit === "llamaindex" || explicit === "openconduit") return explicit;
  if (botId) {
    const profile = await prisma.automationAgentProfile.findFirst({
      where: { botId, organizationId },
      select: { behaviorConfig: true },
    });
    if (profile?.behaviorConfig && shouldUseKnowledgeEngineRuntime(profile.behaviorConfig)) {
      return parseKnowledgeEngineConfig(profile.behaviorConfig).provider;
    }
  }
  const org = await loadOrgKnowledgeStore(organizationId);
  return org.config.provider;
}

export async function optimizeKnowledgeDocumentForRag(input: {
  organizationId: string;
  title: string;
  content: string;
  botId?: string;
  provider?: KnowledgeProviderKind;
  locale?: string;
}): Promise<RagOptimizeResult> {
  const apiKey = config.openAiPromptPreviewKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured on server");
  }

  const title = input.title.trim();
  const content = input.content.trim();
  if (!content) {
    throw new Error("empty_content");
  }

  const provider = await resolveRagProviderForDocumentOptimize(
    input.organizationId,
    input.botId,
    input.provider,
  );
  const locale = input.locale ?? "pt";
  const sectionsBefore = countMarkdownSections(content);
  const model = process.env.OPENAI_KB_OPTIMIZE_MODEL?.trim() || "gpt-4o-mini";

  const userMessage =
    (locale.startsWith("pt")
      ? `Título do documento: ${title || "Sem título"}\n\nConteúdo actual:\n\n`
      : `Document title: ${title || "Untitled"}\n\nCurrent content:\n\n`) + content.slice(0, 96_000);

  const { text } = await callOpenAiCompatibleChat({
    baseUrl: config.openAiApiBaseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    temperature: 0.15,
    maxTokens: Math.min(16_384, Math.max(4096, Math.ceil(content.length / 2))),
    system: buildOptimizeSystemPrompt(provider, locale),
    history: [],
    userMessage,
  });

  let optimized = stripLlmMarkdownWrapper(text);
  if (!optimized.includes("#")) {
    optimized = `# ${title || "Documento"}\n\n${optimized}`;
  }

  const validation = validateFactPreservation(content, optimized);
  if (!validation.ok) {
    optimized = content;
  }

  const sectionsAfter = countMarkdownSections(optimized);

  return {
    content: optimized,
    provider,
    sectionsBefore,
    sectionsAfter,
    factsPreserved: validation.ok,
    missingFacts: validation.missing,
    model,
  };
}

/** Pré-análise rápida (sem LLM) — útil para UI. */
export function analyzeDocumentRagReadiness(content: string): {
  hasSections: boolean;
  sectionCount: number;
  estimatedChunks: number;
  factCount: number;
} {
  const hasSections = contentHasMarkdownSections(content);
  const sectionCount = countMarkdownSections(content);
  const estimatedChunks = chunkMarkdownSections(content, { maxChunks: 80 }).length;
  return {
    hasSections,
    sectionCount,
    estimatedChunks,
    factCount: extractFactFingerprints(content).length,
  };
}
