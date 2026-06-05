import { ScanLine } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export const IMAGE_TRANSCRIPTION_PREFIX = "[Transcrição de imagem]";

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

type Props = {
  body: string;
  className?: string;
};

export function ImageTranscriptionBlock({ body, className }: Props) {
  const { t } = useI18n();
  const data = parseImageTranscriptionBody(body);
  if (!data) return null;

  const description = data.description?.trim();
  const extractedText = data.extractedText?.trim();

  if (!description && !extractedText) return null;

  return (
    <div
      className={
        className ??
        "mt-2 overflow-hidden rounded-xl border border-ink-200/80 bg-ink-50/90 dark:border-ink-700/80 dark:bg-ink-900/50"
      }
    >
      <div className="flex items-center gap-2 border-b border-ink-200/60 bg-ink-100/60 px-3 py-2 dark:border-ink-700/60 dark:bg-ink-800/40">
        <ScanLine className="h-4 w-4 text-brand-600 dark:text-brand-400" />
        <span className="text-xs font-bold uppercase tracking-wide text-ink-700 dark:text-ink-200">
          {t("conversationDetail.imageTranscriptionTitle")}
        </span>
      </div>
      <div className="space-y-3 px-3 py-2.5 text-xs leading-relaxed text-ink-700 dark:text-ink-200">
        {description ? (
          <div>
            <p className="mb-1 font-semibold text-ink-800 dark:text-ink-100">
              {t("conversationDetail.imageTranscriptionDescription")}
            </p>
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{description}</p>
          </div>
        ) : null}
        {extractedText ? (
          <div>
            <p className="mb-1 font-semibold text-ink-800 dark:text-ink-100">
              {t("conversationDetail.imageTranscriptionExtracted")}
            </p>
            <p className="whitespace-pre-wrap break-words font-mono text-[11px] [overflow-wrap:anywhere]">
              {extractedText}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
