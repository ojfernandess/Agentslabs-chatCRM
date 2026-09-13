import clsx from "clsx";
import { Subtitles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
  text: string;
  /** Mensagem enviada pelo atendente (bolha outbound). */
  outbound?: boolean;
  className?: string;
};

export function AudioTranscriptionBlock({ text, outbound = false, className }: Props) {
  const { t } = useI18n();
  const spoken = text.trim();
  if (!spoken) return null;

  return (
    <div
      className={clsx(
        "chat-media-transcription",
        outbound ? "chat-media-transcription--outbound" : "chat-media-transcription--inbound",
        className,
      )}
    >
      <div className="chat-media-transcription__header">
        <Subtitles className="chat-media-transcription__icon h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        <span className="chat-media-transcription__title">
          {t("conversationDetail.imageTranscriptionTitle")}
        </span>
      </div>
      <p className="chat-media-transcription__body">{spoken}</p>
    </div>
  );
}
