/** Moeda padrão do sistema (Real brasileiro). */
export const APP_CURRENCY = "BRL";

const DISPLAY_LOCALE = "pt-BR";

export function formatCurrencyFromCents(cents: number, currency: string = APP_CURRENCY): string {
  return new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency }).format(cents / 100);
}

/** Valor já em unidades da moeda (ex.: reais totais, não centavos). */
export function formatCurrencyUnits(units: number, currency: string = APP_CURRENCY): string {
  return new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency }).format(units);
}
