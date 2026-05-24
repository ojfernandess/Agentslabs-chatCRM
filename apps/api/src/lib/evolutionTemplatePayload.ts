import { maxBodyPlaceholderIndex } from "./templateVariables.js";

/** Componentes no formato Meta / Evolution API v2 (`POST /template/create/{instance}`). */
export function buildEvolutionTemplateCreateComponents(
  body: string,
  footer?: string,
  sampleRow?: string[],
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  const bodyComp: Record<string, unknown> = {
    type: "BODY",
    text: body,
  };

  const maxIdx = maxBodyPlaceholderIndex(body);
  if (maxIdx > 0) {
    const row: string[] = [];
    for (let i = 1; i <= maxIdx; i++) {
      row.push(sampleRow?.[i - 1]?.trim() || `exemplo_${i}`);
    }
    bodyComp.example = { body_text: [row] };
  }

  components.push(bodyComp);

  if (footer?.trim()) {
    components.push({ type: "FOOTER", text: footer.trim() });
  }

  return components;
}

export function normalizeEvolutionTemplateName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function parseEvolutionUpstreamError(status: number, rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return `Evolution template/create falhou (${status})`;
  }
  try {
    const json = JSON.parse(trimmed) as unknown;
    if (json && typeof json === "object") {
      const root = json as Record<string, unknown>;
      const err = root.error;
      if (err && typeof err === "object") {
        const msg = (err as Record<string, unknown>).message;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
      }
      if (typeof root.message === "string" && root.message.trim()) return root.message.trim();
    }
  } catch {
    /* plain text */
  }
  if (trimmed.length > 500) return `Evolution template/create: ${status} ${trimmed.slice(0, 500)}…`;
  return `Evolution template/create: ${status} ${trimmed}`;
}
