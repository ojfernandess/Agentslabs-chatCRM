import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

/** ~9.5rem — alinhado ao CSS `.chat-media-transcription__body--collapsed`. */
const COLLAPSED_MAX_HEIGHT_PX = 152;

type Props = {
  children: ReactNode;
  className?: string;
};

export function TranscriptionCollapsibleBody({ children, className }: Props) {
  const { t } = useI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      setCollapsible(el.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <>
      <div
        ref={contentRef}
        className={clsx(
          className,
          collapsible && !expanded && "chat-media-transcription__body--collapsed",
        )}
      >
        {children}
      </div>
      {collapsible ? (
        <button
          type="button"
          className="chat-media-transcription__read-more"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded
            ? t("conversationDetail.transcriptionReadLess")
            : t("conversationDetail.transcriptionReadMore")}
          <ChevronDown
            className={clsx("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </button>
      ) : null}
    </>
  );
}
