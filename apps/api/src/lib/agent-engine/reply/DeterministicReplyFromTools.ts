/** Outcome mínimo para síntese determinística pós-tool (sem novo LLM). */
import {
  buildModeloC6OptionsReply,
  looksLikeAvailabilityQuotePayload,
} from "../quote/quoteAvailabilityReply.js";

export type DeterministicToolOutcome = {
  name: string;
  ok?: boolean;
  preview?: string;
  monitored?: boolean;
  structuredPayload?: unknown;
};

function previewSource(outcome: DeterministicToolOutcome): string {
  const preview = (outcome.preview ?? "").trim();
  if (preview) return preview;
  if (outcome.structuredPayload != null) {
    try {
      return JSON.stringify(outcome.structuredPayload);
    } catch {
      return "";
    }
  }
  return "";
}

export function humanizeToolPreviewForCustomer(preview: string): string {
  const raw = preview.trim();
  if (!raw) return "";
  // Check-in completion em JSON bruto — ack fixo, nunca ecoar payload.
  if (/^\s*[\[{]/.test(raw) && /check-in\s+realizado|validatedCheckin|hasCheckinApproved/i.test(raw)) {
    return "Seu check-in foi concluído com sucesso! Consultei a reserva — se precisar de endereço, Wi-Fi ou acesso, é só avisar.";
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      if (Array.isArray(o.articles)) {
        return "";
      }
      for (const key of [
        "message",
        "mensagem",
        "summary",
        "resumo",
        "status",
        "result",
        "resultado",
        "guestName",
        "reservationCode",
        "confirmationCode",
      ]) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) {
          // API success strings are not customer-ready ack scripts.
          if (/check-in\s+realizado/i.test(v)) {
            return "Seu check-in foi concluído com sucesso! Consultei a reserva — se precisar de endereço, Wi-Fi ou acesso, é só avisar.";
          }
          return v.trim().slice(0, 600);
        }
      }
      if (typeof o.found === "boolean") {
        const bits: string[] = [];
        bits.push(
          o.found
            ? "Consulta concluída com registo encontrado."
            : "Consulta concluída — não encontramos o registo pedido.",
        );
        for (const key of ["guestName", "name", "reservationCode", "code", "checkIn", "checkOut"]) {
          const v = o[key];
          if (typeof v === "string" && v.trim()) bits.push(`${key}: ${v.trim()}`);
        }
        return bits.join(" ").slice(0, 600);
      }
    }
  } catch {
    /* plain text */
  }
  if (/^\s*[\[{]/.test(raw)) return "";
  return raw.replace(/\s+/g, " ").slice(0, 500);
}

/**
 * Resposta de última linha sem novo LLM — usa previews das tools já executadas.
 * Evita «texto vazio — sem envio» após rate limit / falha na síntese final.
 */
export function buildDeterministicReplyFromToolOutcomes(
  toolOutcomes: DeterministicToolOutcome[],
): string {
  const preferred = [
    ...toolOutcomes.filter((t) => t.monitored && t.ok),
    ...toolOutcomes.filter((t) => t.ok && t.name !== "buscar_conhecimento"),
    ...toolOutcomes.filter((t) => t.ok),
    ...toolOutcomes,
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const t of preferred) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    if (t.name === "buscar_conhecimento") continue;
    const payload = t.structuredPayload ?? (() => {
      try {
        return JSON.parse(previewSource(t));
      } catch {
        return null;
      }
    })();
    if (looksLikeAvailabilityQuotePayload(payload)) {
      const quote = buildModeloC6OptionsReply(payload);
      if (quote.trim()) return quote;
    }
    const human = humanizeToolPreviewForCustomer(previewSource(t));
    if (!human) continue;
    lines.push(human);
    if (lines.length >= 2) break;
  }
  if (lines.length > 0) {
    return (
      "Segue o resultado da consulta:\n\n" +
      lines.join("\n\n") +
      "\n\nSe precisar de mais algum detalhe, é só dizer."
    ).slice(0, 3500);
  }
  if (toolOutcomes.some((t) => t.ok)) {
    return "Já consultei o sistema com base no seu pedido. Pode confirmar o próximo passo ou partilhar mais algum detalhe para eu avançar?";
  }
  return "Tentei consultar o sistema, mas não obtive um resultado útil ainda. Pode repetir o pedido ou partilhar mais um detalhe (por exemplo código ou nome)?";
}
