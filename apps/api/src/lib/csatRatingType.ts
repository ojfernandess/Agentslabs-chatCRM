export const CSAT_RATING_TYPES = ["number", "star", "emoji"] as const;
export type CsatRatingType = (typeof CSAT_RATING_TYPES)[number];

export function normalizeCsatRatingType(raw: string | null | undefined): CsatRatingType {
  if (raw === "star" || raw === "emoji") return raw;
  return "number";
}

/** Emojis CSAT 1–5 (pior → melhor). */
export const CSAT_EMOJI_BY_SCORE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "😡",
  2: "😕",
  3: "😐",
  4: "🙂",
  5: "😍",
};
