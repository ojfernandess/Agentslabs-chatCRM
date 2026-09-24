import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import {
  applyPlatformFont,
  buildPlatformFontStack,
  DEFAULT_PLATFORM_FONT,
  ensurePlatformFontStylesheet,
  invalidatePlatformTypographyCache,
  isPlatformFontId,
  PLATFORM_FONT_OPTIONS,
  type PlatformFontId,
  type PlatformTypographyConfig,
} from "@/lib/platformTypography";

export function SuperAdminPlatformTypographyPanel() {
  const { t } = useI18n();
  const [savedFont, setSavedFont] = useState<PlatformFontId>(DEFAULT_PLATFORM_FONT);
  const [draftFont, setDraftFont] = useState<PlatformFontId>(DEFAULT_PLATFORM_FONT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<PlatformTypographyConfig>("/super/platform-typography");
      const font = isPlatformFontId(data?.font) ? data.font : DEFAULT_PLATFORM_FONT;
      setSavedFont(font);
      setDraftFont(font);
    } catch {
      setError(t("superAdmin.platformTypography.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    ensurePlatformFontStylesheet(draftFont);
  }, [draftFont]);

  const previewStack = useMemo(() => buildPlatformFontStack(draftFont), [draftFont]);
  const dirty = draftFont !== savedFont;

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const saved = await api.put<PlatformTypographyConfig>("/super/platform-typography", {
        font: draftFont,
      });
      const font = isPlatformFontId(saved?.font) ? saved.font : DEFAULT_PLATFORM_FONT;
      setSavedFont(font);
      setDraftFont(font);
      invalidatePlatformTypographyCache();
      applyPlatformFont(font);
      setMessage(t("superAdmin.platformTypography.saved"));
    } catch {
      setError(t("superAdmin.platformTypography.saveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="card-surface p-6">
        <p className="text-sm text-ink-500">{t("common.loading")}</p>
      </section>
    );
  }

  return (
    <section className="card-surface space-y-6 p-6">
      <div>
        <h2 className="font-semibold text-ink-900">{t("superAdmin.platformTypography.title")}</h2>
        <p className="mt-1 text-sm text-ink-600">{t("superAdmin.platformTypography.subtitle")}</p>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p> : null}

      <p className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        {t("superAdmin.platformTypography.globalHint")}
      </p>

      <div className="max-w-xl space-y-2">
        <label htmlFor="platform-font-select" className="block text-xs font-medium text-ink-600">
          {t("superAdmin.platformTypography.fontLabel")}
        </label>
        <select
          id="platform-font-select"
          value={draftFont}
          onChange={(e) => {
            const next = e.target.value;
            if (isPlatformFontId(next)) setDraftFont(next);
          }}
          className="input-field"
        >
          {PLATFORM_FONT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id} style={{ fontFamily: buildPlatformFontStack(option.id) }}>
              {option.recommended
                ? `${option.label} — ${t("superAdmin.platformTypography.recommendedSuffix")}`
                : option.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-500">{t("superAdmin.platformTypography.fontHint")}</p>
      </div>

      <div
        className="rounded-2xl border border-ink-200/80 bg-gradient-to-br from-white to-ink-50/80 p-5 shadow-sm dark:border-soft-border dark:from-[#151826] dark:to-[#1B2230]"
        style={{ fontFamily: previewStack }}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
          {t("superAdmin.platformTypography.previewTitle")}
        </p>
        <p className="mt-3 text-2xl font-semibold text-ink-900 dark:text-ink-50">
          {t("superAdmin.platformTypography.previewHeading")}
        </p>
        <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
          {t("superAdmin.platformTypography.previewBody")}
        </p>
        <p className="mt-4 text-xs text-ink-500 dark:text-ink-400">
          {t("superAdmin.platformTypography.previewFootnote")}
        </p>
      </div>

      <button type="button" className="btn-primary" disabled={saving || !dirty} onClick={() => void save()}>
        {saving ? t("common.loading") : t("common.save")}
      </button>
    </section>
  );
}
