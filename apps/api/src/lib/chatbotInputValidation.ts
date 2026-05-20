/** Validação de respostas dos blocos de entrada (Fase 2). */

export type ChatbotValidatedInputKind = "text" | "email" | "number" | "phone" | "date" | "rating";

export function isChatbotValidatedInputKind(k: string): k is ChatbotValidatedInputKind {
  return k === "text" || k === "email" || k === "number" || k === "phone" || k === "date" || k === "rating";
}

export interface ChatbotInputValidationOpts {
  numberMin?: number;
  numberMax?: number;
  ratingMin?: number;
  ratingMax?: number;
}

export type ChatbotInputValidationResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function validateChatbotUserInput(
  kind: ChatbotValidatedInputKind,
  raw: string,
  opts?: ChatbotInputValidationOpts,
): ChatbotInputValidationResult {
  const t = raw.trim();
  switch (kind) {
    case "text":
      if (!t) return { ok: false, message: "Escreva uma resposta." };
      return { ok: true, value: t };
    case "email": {
      if (!t) return { ok: false, message: "Indique um email." };
      const simple = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!simple.test(t)) return { ok: false, message: "Email inválido (ex.: nome@empresa.pt)." };
      return { ok: true, value: t.toLowerCase() };
    }
    case "number": {
      if (!t) return { ok: false, message: "Indique um número." };
      const n = Number(t.replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, message: "Não é um número válido." };
      const min = opts?.numberMin;
      const max = opts?.numberMax;
      if (min !== undefined && !Number.isNaN(min) && n < min) {
        return { ok: false, message: `O valor deve ser ≥ ${min}.` };
      }
      if (max !== undefined && !Number.isNaN(max) && n > max) {
        return { ok: false, message: `O valor deve ser ≤ ${max}.` };
      }
      return { ok: true, value: String(n) };
    }
    case "phone": {
      if (!t) return { ok: false, message: "Indique um telefone." };
      const digits = t.replace(/\D/g, "");
      if (digits.length < 8) return { ok: false, message: "Telefone demasiado curto (mín. 8 dígitos)." };
      const normalized = t.trim().startsWith("+") ? `+${digits}` : t.trim();
      return { ok: true, value: normalized };
    }
    case "date": {
      if (!t) return { ok: false, message: "Indique uma data." };
      let d: Date | null = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        d = new Date(`${t}T12:00:00`);
      } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
        const parts = t.split("/").map((x) => Number.parseInt(x, 10));
        if (parts.length === 3 && parts.every((x) => Number.isFinite(x))) {
          const [day, month, year] = parts;
          d = new Date(year, month - 1, day);
        }
      }
      if (!d || Number.isNaN(d.getTime())) {
        return { ok: false, message: "Use AAAA-MM-DD ou DD/MM/AAAA." };
      }
      return { ok: true, value: d.toISOString().slice(0, 10) };
    }
    case "rating": {
      const rmin = opts?.ratingMin ?? 1;
      const rmax = opts?.ratingMax ?? 5;
      const n = Number.parseInt(t, 10);
      if (!Number.isFinite(n) || n < rmin || n > rmax) {
        return { ok: false, message: `Responda com um número de ${rmin} a ${rmax}.` };
      }
      return { ok: true, value: String(n) };
    }
    default:
      if (!t) return { ok: false, message: "Escreva uma resposta." };
      return { ok: true, value: t };
  }
}
