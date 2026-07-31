import { searchAdrs } from "./adrStore.js";
import { searchRcas } from "./rcaStore.js";
import { componentsForFilePath } from "./componentRegistry.js";
import type { ImplementationReviewResult, ProposedChange } from "./types.js";

export function runImplementationReview(
  proposal: ProposedChange,
  repoRoot?: string,
): ImplementationReviewResult {
  const terms = [
    proposal.problem,
    proposal.rootCause,
    proposal.component,
    ...proposal.modifiedFiles.map((f) => f.split("/").pop() ?? f),
  ].filter(Boolean);

  const similarAdrs = new Map<string, ReturnType<typeof searchAdrs>[number]>();
  const similarRcas = new Map<string, ReturnType<typeof searchRcas>[number]>();

  for (const term of terms.slice(0, 6)) {
    for (const a of searchAdrs(term, repoRoot)) similarAdrs.set(a.id, a);
    for (const r of searchRcas(term, repoRoot)) similarRcas.set(r.id, r);
  }

  const recurringProblems = [...similarRcas.values()]
    .filter((r) => r.recurrenceCount > 1)
    .map((r) => `${r.title} (${r.recurrenceCount}x)`);

  const relatedComponents = [
    ...new Set(proposal.modifiedFiles.flatMap((f) => componentsForFilePath(f).map((c) => c.name))),
  ];

  const shouldReuseExisting =
    similarAdrs.size > 0 &&
    similarAdrs.size <= 3 &&
    [...similarAdrs.values()].some((a) => a.status === "accepted");

  const reuseRecommendation = shouldReuseExisting
    ? `Reutilizar padrão de ${[...similarAdrs.values()].map((a) => a.id).join(", ")} — evitar duplicar solução.`
    : recurringProblems.length > 0
      ? `Consultar RCA recorrente antes de implementar: ${recurringProblems.join("; ")}`
      : "Nenhuma solução semelhante encontrada — documentar via ADR.";

  return {
    similarAdrs: [...similarAdrs.values()].slice(0, 10),
    similarRcas: [...similarRcas.values()].slice(0, 10),
    recurringProblems,
    relatedComponents,
    reuseRecommendation,
    shouldReuseExisting,
  };
}
