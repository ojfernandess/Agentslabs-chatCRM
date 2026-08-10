/** Largura da fila (split view) em Conversas — preferência da organização. */
export type ConversationsSplitViewSize = "default" | "medium" | "large";

export const CONVERSATIONS_SPLIT_VIEW_SIZES: ConversationsSplitViewSize[] = [
  "default",
  "medium",
  "large",
];

const STORAGE_KEY_PREFIX = "openconduit_conversations_split_view_size";
export const CONVERSATIONS_SPLIT_VIEW_CHANGED_EVENT = "openconduit:conversations-split-view-size";

export function parseConversationsSplitViewSize(
  value: unknown,
): ConversationsSplitViewSize {
  if (value === "medium" || value === "large" || value === "default") return value;
  return "default";
}

function storageKey(organizationId?: string | null): string {
  const org = organizationId?.trim();
  return org ? `${STORAGE_KEY_PREFIX}:${org}` : STORAGE_KEY_PREFIX;
}

/** Lê a largura em cache (síncrono) — evita flash do tamanho «default» ao abrir Conversas. */
export function readCachedConversationsSplitViewSize(
  organizationId?: string | null,
): ConversationsSplitViewSize {
  if (typeof window === "undefined") return "default";
  try {
    const scoped = localStorage.getItem(storageKey(organizationId));
    if (scoped) return parseConversationsSplitViewSize(scoped);
    // Fallback legado (antes da chave por org).
    if (organizationId) {
      const legacy = localStorage.getItem(STORAGE_KEY_PREFIX);
      if (legacy) return parseConversationsSplitViewSize(legacy);
    }
  } catch {
    /* ignore */
  }
  return "default";
}

/** Guarda a largura escolhida como padrão local e notifica a UI aberta. */
export function writeCachedConversationsSplitViewSize(
  size: ConversationsSplitViewSize,
  organizationId?: string | null,
): void {
  if (typeof window === "undefined") return;
  const parsed = parseConversationsSplitViewSize(size);
  try {
    localStorage.setItem(storageKey(organizationId), parsed);
    localStorage.setItem(STORAGE_KEY_PREFIX, parsed);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(CONVERSATIONS_SPLIT_VIEW_CHANGED_EVENT, {
      detail: { size: parsed, organizationId: organizationId ?? null },
    }),
  );
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
