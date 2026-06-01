import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";

export function NvoipTrunkPicker() {
  const { t } = useI18n();
  const voice = useNvoipVoiceOptional();
  if (!voice?.canPlaceCalls || voice.trunks.length === 0 || voice.activeCall) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[110] flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-ink-700 dark:bg-ink-900/95">
      <label className="font-medium text-slate-600 dark:text-ink-300" htmlFor="nvoip-trunk-picker">
        {t("nvoip.trunks.title")}
      </label>
      <select
        id="nvoip-trunk-picker"
        value={voice.selectedTrunkId ?? ""}
        onChange={(e) => voice.setSelectedTrunkId(e.target.value || null)}
        className="max-w-[10rem] rounded border border-slate-200 px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-950"
      >
        <option value="">{t("nvoip.trunks.auto")}</option>
        {voice.trunks.map((tr) => (
          <option key={tr.id} value={tr.id}>
            {tr.name} ({tr.defaultCaller})
          </option>
        ))}
      </select>
    </div>
  );
}
