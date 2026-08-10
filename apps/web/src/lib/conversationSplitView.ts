/** Largura da fila (split view) em Conversas — preferência da organização. */
export type ConversationsSplitViewSize = "default" | "medium" | "large";

export const CONVERSATIONS_SPLIT_VIEW_SIZES: ConversationsSplitViewSize[] = [
  "default",
  "medium",
  "large",
];

export function parseConversationsSplitViewSize(
  value: unknown,
): ConversationsSplitViewSize {
  if (value === "medium" || value === "large" || value === "default") return value;
  return "default";
}

/**
 * Classes de grelha desktop para a lista | conversa.
 * Mobile (<lg) permanece coluna única — inalterado.
 */
export function conversationsSplitViewGridClass(
  size: ConversationsSplitViewSize,
): string {
  switch (size) {
    case "medium":
      return [
        "lg:grid-cols-[minmax(0,min(300px,38%))_minmax(0,1fr)]",
        "xl:grid-cols-[minmax(0,min(360px,32%))_minmax(0,1fr)]",
        "2xl:grid-cols-[minmax(0,min(420px,28%))_minmax(0,1fr)]",
      ].join(" ");
    case "large":
      // Base ~536px; em ecrãs muito largos cresce um pouco (até ~600px).
      return [
        "lg:grid-cols-[minmax(0,min(536px,42%))_minmax(0,1fr)]",
        "xl:grid-cols-[minmax(0,min(536px,40%))_minmax(0,1fr)]",
        "2xl:grid-cols-[minmax(0,min(600px,34%))_minmax(0,1fr)]",
      ].join(" ");
    case "default":
    default:
      return [
        "lg:grid-cols-[minmax(0,min(220px,34%))_minmax(0,1fr)]",
        "xl:grid-cols-[minmax(0,min(260px,28%))_minmax(0,1fr)]",
        "2xl:grid-cols-[minmax(0,min(320px,24%))_minmax(0,1fr)]",
      ].join(" ");
  }
}
