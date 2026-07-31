import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchitectureDecisionRecord, CreateAdrInput } from "./types.js";
import { adrDir } from "./paths.js";

function adrFilePath(id: string, repoRoot?: string): string {
  return join(adrDir(repoRoot), `${id}.json`);
}

function nextAdrId(existing: ArchitectureDecisionRecord[]): string {
  let max = 0;
  for (const a of existing) {
    const m = /^ADR-(\d+)$/i.exec(a.id);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `ADR-${String(max + 1).padStart(4, "0")}`;
}

export function listAdrs(repoRoot?: string): ArchitectureDecisionRecord[] {
  const dir = adrDir(repoRoot);
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const raw = readFileSync(join(dir, f), "utf8");
        return JSON.parse(raw) as ArchitectureDecisionRecord;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export function getAdr(id: string, repoRoot?: string): ArchitectureDecisionRecord | null {
  try {
    const raw = readFileSync(adrFilePath(id, repoRoot), "utf8");
    return JSON.parse(raw) as ArchitectureDecisionRecord;
  } catch {
    return null;
  }
}

export function searchAdrs(query: string, repoRoot?: string): ArchitectureDecisionRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return listAdrs(repoRoot);
  return listAdrs(repoRoot).filter((a) => {
    const blob = [
      a.id,
      a.title,
      a.component,
      a.problem,
      a.rootCause,
      a.reason,
      ...(Array.isArray(a.categories) ? a.categories : []),
      ...(Array.isArray(a.modifiedFiles) ? a.modifiedFiles : []),
    ]
      .join(" ")
      .toLowerCase();
    return blob.includes(q);
  });
}

export function createAdr(input: CreateAdrInput, repoRoot?: string): ArchitectureDecisionRecord {
  const dir = adrDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  const existing = listAdrs(repoRoot);
  const id = input.id ?? nextAdrId(existing);
  const adr: ArchitectureDecisionRecord = {
    ...input,
    id,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    version: input.version ?? "1.0.0",
    status: input.status ?? "accepted",
    actualImpact: input.actualImpact ?? "",
    categories: input.categories ?? ["Architecture"],
    alternativesAnalyzed: input.alternativesAnalyzed ?? [],
    alternativesDiscarded: input.alternativesDiscarded ?? [],
    risks: input.risks ?? [],
    testsExecuted: input.testsExecuted ?? [],
    references: input.references ?? [],
    modifiedFiles: input.modifiedFiles ?? [],
  };
  writeFileSync(adrFilePath(id, repoRoot), JSON.stringify(adr, null, 2), "utf8");
  return adr;
}

export function renderAdrMarkdown(adr: ArchitectureDecisionRecord): string {
  return `# ${adr.id}: ${adr.title}

| Campo | Valor |
|-------|-------|
| **Data** | ${adr.date} |
| **Autor** | ${adr.author} |
| **Versão** | ${adr.version} |
| **Branch** | ${adr.branch} |
| **Commit** | ${adr.commit} |
| **Componente** | ${adr.component} |
| **Status** | ${adr.status} |
| **Categorias** | ${adr.categories.join(", ")} |

## Motivo

${adr.reason}

## Problema

${adr.problem}

## Causa raiz

${adr.rootCause}

## Alternativas analisadas

${adr.alternativesAnalyzed.map((a) => `- ${a}`).join("\n") || "- (nenhuma)"}

## Alternativas descartadas

${adr.alternativesDiscarded.map((a) => `- ${a}`).join("\n") || "- (nenhuma)"}

## Justificativa técnica

${adr.technicalJustification}

## Arquitetura antes

${adr.architectureBefore}

## Arquitetura depois

${adr.architectureAfter}

## Impacto esperado

${adr.expectedImpact}

## Impacto real

${adr.actualImpact || "_A documentar após deploy._"}

## Riscos

${adr.risks.map((r) => `- ${r}`).join("\n") || "- (nenhum identificado)"}

## Rollback

${adr.rollback}

## Testes

${adr.testsExecuted.map((t) => `- ${t}`).join("\n") || "- (nenhum)"}

**Resultado:** ${adr.testResult}

## Ficheiros modificados

${adr.modifiedFiles.map((f) => `- \`${f}\``).join("\n")}

## Referências

${adr.references.map((r) => `- ${r}`).join("\n") || "- (nenhuma)"}
`;
}

export function writeAdrMarkdown(adr: ArchitectureDecisionRecord, repoRoot?: string): void {
  const dir = adrDir(repoRoot);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${adr.id}.md`), renderAdrMarkdown(adr), "utf8");
}
