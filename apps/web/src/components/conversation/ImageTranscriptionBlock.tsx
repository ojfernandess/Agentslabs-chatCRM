import clsx from "clsx";
import { ScanLine } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { TranscriptionCollapsibleBody } from "@/components/conversation/TranscriptionCollapsibleBody";
import { IMAGE_TRANSCRIPTION_PREFIX, parseImageTranscriptionBody } from "@/lib/messagePreviewText";

export { IMAGE_TRANSCRIPTION_PREFIX, parseImageTranscriptionBody };

type Props = {
  body: string;
  /** Mensagem enviada pelo atendente (bolha outbound). */
  outbound?: boolean;
  className?: string;
};

export function ImageTranscriptionBlock({ body, outbound = false, className }: Props) {
  const { t } = useI18n();
  const data = parseImageTranscriptionBody(body);
  if (!data) return null;

  const description = data.description?.trim();
  const extractedText = data.extractedText?.trim();

  if (!description && !extractedText) return null;

  return (
    <div
      className={clsx(
        "chat-media-transcription",
        outbound ? "chat-media-transcription--outbound" : "chat-media-transcription--inbound",
        className,
      )}
    >
      <div className="chat-media-transcription__header">
        <ScanLine className="chat-media-transcription__icon h-4 w-4" aria-hidden />
        <span className="chat-media-transcription__title">
          {t("conversationDetail.imageTranscriptionTitle")}
        </span>
      </div>
      <TranscriptionCollapsibleBody className="chat-media-transcription__body space-y-3">
        {description ? (
          <div>
            <p className="chat-media-transcription__section-label">
              {t("conversationDetail.imageTranscriptionDescription")}
            </p>
            <p>{description}</p>
          </div>
        ) : null}
        {extractedText ? (
          <div>
            <p className="chat-media-transcription__section-label">
              {t("conversationDetail.imageTranscriptionExtracted")}
            </p>
            <p className="chat-media-transcription__extracted">{extractedText}</p>
          </div>
        ) : null}
      </TranscriptionCollapsibleBody>
    </div>
  );
}
