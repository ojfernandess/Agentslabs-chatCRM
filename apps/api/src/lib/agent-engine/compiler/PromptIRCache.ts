/**
 * Cache de extracção estática do Prompt IR por playbookHash.
 * Turn-resolved fields são sempre recomputados.
 */
import type { StaticPromptIRExtract } from "./extractStaticPromptIR.js";
import { extractStaticPromptIR } from "./extractStaticPromptIR.js";

const MAX_CACHE_ENTRIES = 128;
const cache = new Map<string, StaticPromptIRExtract>();

export function getCachedStaticPromptIR(playbook: string, playbookHash: string): StaticPromptIRExtract {
  const hit = cache.get(playbookHash);
  if (hit) return hit;

  const extracted = extractStaticPromptIR(playbook);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(playbookHash, extracted);
  return extracted;
}

/** Limpa cache — testes. */
export function clearPromptIRCache(): void {
  cache.clear();
}

export function promptIRCacheSize(): number {
  return cache.size;
}
