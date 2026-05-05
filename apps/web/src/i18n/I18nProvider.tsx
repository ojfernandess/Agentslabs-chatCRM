import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ptBR as dateFnsPtBR, enUS as dateFnsEnUS } from "date-fns/locale";
import {
  LOCALE_STORAGE_KEY,
  translate,
  type LocaleCode,
} from "@/i18n/messages";

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (path: string) => string;
  dateLocale: typeof dateFnsPtBR;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): LocaleCode {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (v === "en" || v === "pt-BR") return v;
  } catch {
    /* ignore */
  }
  return "pt-BR";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    if (typeof window === "undefined") return "pt-BR";
    return readStoredLocale();
  });

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((path: string) => translate(locale, path), [locale]);

  const dateLocale = locale === "pt-BR" ? dateFnsPtBR : dateFnsEnUS;

  const value = useMemo(
    () => ({ locale, setLocale, t, dateLocale }),
    [locale, setLocale, t, dateLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
