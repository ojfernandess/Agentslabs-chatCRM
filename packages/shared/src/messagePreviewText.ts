export const IMAGE_TRANSCRIPTION_PREFIX = "[Transcrição de imagem]";
export const AUDIO_TRANSCRIPTION_PREFIX = "[Transcrição automática]";

export type ImageTranscriptionPayload = {
  description?: string;
  extractedText?: string;
};

export function parseImageTranscriptionBody(body: string | null | undefined): ImageTranscriptionPayload | null {
  if (!body?.startsWith(IMAGE_TRANSCRIPTION_PREFIX)) return null;
  const raw = body.slice(IMAGE_TRANSCRIPTION_PREFIX.length).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImageTranscriptionPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return { description: raw, extractedText: "" };
  }
}

/** Texto legível para listas e notificações — oculta JSON de transcrição automática. */
export function formatMessageBodyForPreview(
  body: string | null | undefined,
  options?: { messageType?: string; emptyFallback?: string },
): string {
  const emptyFallback = options?.emptyFallback ?? "";
  const trimmed = body?.trim() ?? "";
  if (!trimmed) {
    const t = options?.messageType?.toUpperCase();
    if (t === "IMAGE") return emptyFallback || "Imagem";
    if (t === "VIDEO") return emptyFallback || "Vídeo";
    if (t === "AUDIO") return emptyFallback || "Áudio";
    if (t === "DOCUMENT") return emptyFallback || "Documento";
    return emptyFallback;
  }

  const imageTrans = parseImageTranscriptionBody(trimmed);
  if (imageTrans) {
    const parts: string[] = [];
    if (imageTrans.description?.trim()) parts.push(imageTrans.description.trim());
    if (imageTrans.extractedText?.trim()) parts.push(imageTrans.extractedText.trim());
    return parts.join(" · ") || emptyFallback || "Imagem";
  }

  if (trimmed.startsWith(AUDIO_TRANSCRIPTION_PREFIX)) {
    const spoken = trimmed.slice(AUDIO_TRANSCRIPTION_PREFIX.length).trim();
    return spoken || emptyFallback || "Áudio";
  }

  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}…` : trimmed;
}
