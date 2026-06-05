import { Link2, Variable } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type MediaBlockType = "image" | "video" | "audio";

type Props = {
  blockType: MediaBlockType;
  data: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
};

function mediaUrlFromData(data: Record<string, unknown>): string {
  return String(data.url ?? data.mediaUrl ?? "").trim();
}

export function ChatbotMediaBlockFields({ blockType, data, onPatch }: Props) {
  const { t } = useI18n();
  const sourceMode = String(data.urlSource ?? "link") === "variable" ? "variable" : "link";
  const url = mediaUrlFromData(data);
  const showCaption = blockType === "image" || blockType === "video";

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1.5 block text-xs font-semibold text-ink-600 dark:text-ink-400">
          {t("chatbotPage.mediaSourceMode")}
        </span>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900">
          <button
            type="button"
            onClick={() => onPatch({ urlSource: "link" })}
            className={
              sourceMode === "link"
                ? "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-2 py-2 text-[11px] font-semibold text-white"
                : "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
            }
          >
            <Link2 className="h-3.5 w-3.5" />
            {t("chatbotPage.mediaSourceLink")}
          </button>
          <button
            type="button"
            onClick={() => onPatch({ urlSource: "variable" })}
            className={
              sourceMode === "variable"
                ? "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-2 py-2 text-[11px] font-semibold text-white"
                : "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800"
            }
          >
            <Variable className="h-3.5 w-3.5" />
            {t("chatbotPage.mediaSourceVariable")}
          </button>
        </div>
      </div>

      {sourceMode === "link" ? (
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">
            {t(`chatbotPage.media${blockType === "image" ? "Image" : blockType === "video" ? "Video" : "Audio"}Url`)}
          </span>
          <input
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
            placeholder="https://"
            value={String(data.url ?? data.mediaUrl ?? "")}
            onChange={(e) => onPatch({ url: e.target.value, mediaUrl: e.target.value })}
          />
          <p className="mt-1 text-[10px] text-ink-400">{t("chatbotPage.mediaUrlHint")}</p>
        </label>
      ) : (
        <>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">
              {t("chatbotPage.mediaUrlVariable")}
            </span>
            <input
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              placeholder="media_url"
              value={String(data.urlVariable ?? "media_url")}
              onChange={(e) => onPatch({ urlVariable: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">
              {t("chatbotPage.mediaUrlFallback")}
            </span>
            <input
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              placeholder="https:// ou {{variavel}}"
              value={String(data.url ?? "")}
              onChange={(e) => onPatch({ url: e.target.value })}
            />
            <p className="mt-1 text-[10px] text-ink-400">{t("chatbotPage.mediaVariableHint")}</p>
          </label>
        </>
      )}

      {showCaption ? (
        <label className="block text-xs">
          <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">
            {t("chatbotPage.mediaCaption")}
          </span>
          <textarea
            rows={2}
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
            placeholder={t("chatbotPage.mediaCaptionPlaceholder")}
            value={String(data.caption ?? data.content ?? "")}
            onChange={(e) => onPatch({ caption: e.target.value, content: e.target.value })}
          />
          <p className="mt-1 text-[10px] text-ink-400">{t("chatbotPage.mediaCaptionHint")}</p>
        </label>
      ) : null}

      {blockType === "image" && url && sourceMode === "link" && /^https?:\/\//i.test(url) ? (
        <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-50 dark:border-ink-700 dark:bg-ink-900/40">
          <img src={url} alt="" className="max-h-36 w-full object-contain" />
        </div>
      ) : null}

      {blockType === "video" && url && sourceMode === "link" && /^https?:\/\//i.test(url) ? (
        <video src={url} controls className="max-h-36 w-full rounded-xl border border-ink-200 dark:border-ink-700" />
      ) : null}

      {blockType === "audio" && url && sourceMode === "link" && /^https?:\/\//i.test(url) ? (
        <audio src={url} controls className="w-full rounded-xl border border-ink-200 px-2 py-1 dark:border-ink-700" />
      ) : null}
    </div>
  );
}
