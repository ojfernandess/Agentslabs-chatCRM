import { Prisma } from "@prisma/client";

export type MoneyDecimal = Prisma.Decimal;

export function money(value: number | string | Prisma.Decimal): MoneyDecimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function moneyZero(): MoneyDecimal {
  return new Prisma.Decimal(0);
}

export function moneyAdd(a: MoneyDecimal, b: MoneyDecimal): MoneyDecimal {
  return a.add(b);
}

export function moneySub(a: MoneyDecimal, b: MoneyDecimal): MoneyDecimal {
  return a.sub(b);
}

export function moneyMul(a: MoneyDecimal, b: number | string | MoneyDecimal): MoneyDecimal {
  return a.mul(b);
}

export function moneyDiv(a: MoneyDecimal, divisor: number | string | MoneyDecimal): MoneyDecimal {
  return a.div(divisor);
}

export function moneyMax(a: MoneyDecimal, b: MoneyDecimal): MoneyDecimal {
  return a.greaterThan(b) ? a : b;
}

export function moneyIsPositive(value: MoneyDecimal): boolean {
  return value.greaterThan(0);
}

export function moneyGte(a: MoneyDecimal, b: MoneyDecimal): boolean {
  return a.greaterThan(b) || a.equals(b);
}

export function moneyToNumber(value: MoneyDecimal): number {
  return value.toNumber();
}

export function moneyToApiString(value: MoneyDecimal): string {
  return value.toFixed(8);
}

/** Converte tokens + preço por 1M tokens → custo (sem arredondar para centavos). */
export function costFromTokensPerMillion(tokens: number, pricePerMillion: MoneyDecimal): MoneyDecimal {
  if (tokens <= 0 || pricePerMillion.lte(0)) return moneyZero();
  return moneyDiv(moneyMul(pricePerMillion, tokens), 1_000_000);
}
