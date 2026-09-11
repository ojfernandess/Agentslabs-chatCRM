import { useMemo, useState } from "react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import {
  centsToCurrencyInput,
  centsToRawCentsInput,
  currencyInputToCents,
  formatMoneyFromCents,
} from "@/lib/moneyInput";

export type MoneyInputMode = "currency" | "cents";

type MoneyCentsInputProps = {
  /** Valor armazenado sempre em centavos (string numérica). */
  valueCents: string;
  onChangeCents: (cents: string) => void;
  currency?: string;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
};

export function MoneyCentsInput({
  valueCents,
  onChangeCents,
  currency = "BRL",
  className,
  inputClassName,
  required,
  disabled,
  id,
}: MoneyCentsInputProps) {
  const { t, locale } = useI18n();
  const localeTag = locale === "en" ? "en-US" : "pt-BR";
  const [mode, setMode] = useState<MoneyInputMode>("currency");

  const centsNumber = useMemo(() => {
    const n = Number.parseInt(valueCents, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [valueCents]);

  const displayValue =
    mode === "currency" ? centsToCurrencyInput(valueCents) : centsToRawCentsInput(valueCents);

  const hint =
    mode === "currency"
      ? t("superAdmin.moneyInputCentsHint").replace("{cents}", String(centsNumber))
      : formatMoneyFromCents(centsNumber, currency, localeTag);

  const handleChange = (raw: string) => {
    if (mode === "currency") {
      onChangeCents(String(currencyInputToCents(raw)));
    } else {
      const digits = raw.replace(/\D/g, "");
      onChangeCents(digits);
    }
  };

  return (
    <div className={clsx("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          type={mode === "currency" ? "text" : "number"}
          min={mode === "cents" ? 0 : undefined}
          inputMode={mode === "currency" ? "decimal" : "numeric"}
          value={displayValue}
          onChange={(e) => handleChange(e.target.value)}
          className={clsx("input-field flex-1 min-w-[8rem]", inputClassName)}
          placeholder={mode === "currency" ? "0,00" : "0"}
          required={required}
          disabled={disabled}
        />
        <div className="inline-flex rounded-lg border border-ink-200 p-0.5 text-xs dark:border-soft-border">
          <button
            type="button"
            className={clsx(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              mode === "currency"
                ? "bg-brand-600 text-white"
                : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
            )}
            onClick={() => setMode("currency")}
            disabled={disabled}
          >
            {t("superAdmin.moneyInputCurrency")}
          </button>
          <button
            type="button"
            className={clsx(
              "rounded-md px-2.5 py-1 font-medium transition-colors",
              mode === "cents"
                ? "bg-brand-600 text-white"
                : "text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800",
            )}
            onClick={() => setMode("cents")}
            disabled={disabled}
          >
            {t("superAdmin.moneyInputCents")}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-ink-500 dark:text-ink-400">{hint}</p>
    </div>
  );
}
