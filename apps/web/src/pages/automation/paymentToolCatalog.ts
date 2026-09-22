export type StripeCatalogRow = {
  id: string;
  label: string;
  productId: string;
  priceId: string;
  currency: string;
  isDefault: boolean;
};

export type MercadoPagoCatalogRow = {
  id: string;
  label: string;
  planId: string;
  amountCents: string;
  currency: string;
  defaultTitle: string;
  isDefault: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function rowId(): string {
  return `row-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyStripeCatalogRow(isDefault = false): StripeCatalogRow {
  return { id: rowId(), label: "", productId: "", priceId: "", currency: "", isDefault };
}

export function emptyMercadoPagoCatalogRow(isDefault = false): MercadoPagoCatalogRow {
  return { id: rowId(), label: "", planId: "", amountCents: "", currency: "", defaultTitle: "", isDefault };
}

export function stripeCatalogFromConfig(cfg: Record<string, unknown>): StripeCatalogRow[] {
  const raw = cfg.catalog;
  if (Array.isArray(raw) && raw.length > 0) {
    const rows = raw
      .map((item) => {
        const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const priceId = str(o.priceId) || str(o.price_id);
        if (!priceId) return null;
        return {
          id: rowId(),
          label: str(o.label) || str(o.name),
          productId: str(o.productId) || str(o.product_id),
          priceId,
          currency: str(o.currency).toLowerCase(),
          isDefault: o.isDefault === true,
        } satisfies StripeCatalogRow;
      })
      .filter((x): x is StripeCatalogRow => x != null);
    if (rows.length > 0) {
      if (!rows.some((r) => r.isDefault)) rows[0]!.isDefault = true;
      return rows;
    }
  }
  const legacyPrice = str(cfg.defaultPriceId);
  if (legacyPrice) {
    return [
      {
        id: rowId(),
        label: "",
        productId: "",
        priceId: legacyPrice,
        currency: str(cfg.currency).toLowerCase(),
        isDefault: true,
      },
    ];
  }
  return [emptyStripeCatalogRow(true)];
}

export function mercadoPagoCatalogFromConfig(cfg: Record<string, unknown>): MercadoPagoCatalogRow[] {
  const raw = cfg.catalog;
  if (Array.isArray(raw) && raw.length > 0) {
    const rows = raw
      .map((item) => {
        const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const planId = str(o.planId) || str(o.plan_id);
        const amountRaw = o.amountCents ?? o.amount_cents;
        const amountCents =
          typeof amountRaw === "number" && Number.isFinite(amountRaw)
            ? String(Math.floor(amountRaw))
            : str(amountRaw);
        if (!planId && !amountCents) return null;
        return {
          id: rowId(),
          label: str(o.label) || str(o.name),
          planId,
          amountCents,
          currency: str(o.currency).toUpperCase(),
          defaultTitle: str(o.defaultTitle) || str(o.title),
          isDefault: o.isDefault === true,
        } satisfies MercadoPagoCatalogRow;
      })
      .filter((x): x is MercadoPagoCatalogRow => x != null);
    if (rows.length > 0) {
      if (!rows.some((r) => r.isDefault)) rows[0]!.isDefault = true;
      return rows;
    }
  }
  const legacyAmount = cfg.defaultAmountCents ?? cfg.defaultAmount;
  const amountCents =
    typeof legacyAmount === "number" && Number.isFinite(legacyAmount)
      ? String(Math.floor(legacyAmount))
      : str(legacyAmount);
  if (amountCents) {
    return [
      {
        id: rowId(),
        label: "",
        planId: "",
        amountCents,
        currency: str(cfg.currency).toUpperCase() || "BRL",
        defaultTitle: str(cfg.defaultTitle) || "Pagamento",
        isDefault: true,
      },
    ];
  }
  return [emptyMercadoPagoCatalogRow(true)];
}

export function normalizeStripeCatalogRows(rows: StripeCatalogRow[]): StripeCatalogRow[] {
  const filled = rows.filter((r) => r.priceId.trim());
  if (filled.length === 0) return [emptyStripeCatalogRow(true)];
  if (!filled.some((r) => r.isDefault)) filled[0]!.isDefault = true;
  return filled.map((r) => ({ ...r, isDefault: r.id === filled.find((x) => x.isDefault)?.id }));
}

export function normalizeMercadoPagoCatalogRows(rows: MercadoPagoCatalogRow[]): MercadoPagoCatalogRow[] {
  const filled = rows.filter((r) => r.planId.trim() || r.amountCents.trim());
  if (filled.length === 0) return [emptyMercadoPagoCatalogRow(true)];
  if (!filled.some((r) => r.isDefault)) filled[0]!.isDefault = true;
  const defaultId = filled.find((x) => x.isDefault)?.id ?? filled[0]!.id;
  return filled.map((r) => ({ ...r, isDefault: r.id === defaultId }));
}

export function stripeCatalogToConfigPayload(rows: StripeCatalogRow[], fallbackCurrency: string) {
  const normalized = normalizeStripeCatalogRows(rows);
  const catalog = normalized.map(({ id: _id, ...entry }) => ({
    label: entry.label.trim() || undefined,
    productId: entry.productId.trim() || undefined,
    priceId: entry.priceId.trim(),
    currency: entry.currency.trim().toLowerCase() || undefined,
    isDefault: entry.isDefault,
  }));
  const def = normalized.find((r) => r.isDefault) ?? normalized[0]!;
  return {
    catalog,
    defaultPriceId: def.priceId.trim(),
    currency: (def.currency.trim() || fallbackCurrency.trim()).toLowerCase(),
  };
}

export function mercadoPagoCatalogToConfigPayload(
  rows: MercadoPagoCatalogRow[],
  fallbackCurrency: string,
  fallbackTitle: string,
) {
  const normalized = normalizeMercadoPagoCatalogRows(rows);
  const catalog = normalized.map(({ id: _id, ...entry }) => {
    const amountTrimmed = entry.amountCents.trim();
    const amountCents = amountTrimmed ? Number(amountTrimmed) : undefined;
    return {
      label: entry.label.trim() || undefined,
      planId: entry.planId.trim() || undefined,
      amountCents: amountCents != null && Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : undefined,
      currency: entry.currency.trim().toUpperCase() || undefined,
      defaultTitle: entry.defaultTitle.trim() || undefined,
      isDefault: entry.isDefault,
    };
  });
  const def = normalized.find((r) => r.isDefault) ?? normalized[0]!;
  const amountTrimmed = def.amountCents.trim();
  const amountNum = amountTrimmed ? Number(amountTrimmed) : NaN;
  return {
    catalog,
    defaultAmountCents: Number.isFinite(amountNum) && amountNum > 0 ? Math.floor(amountNum) : null,
    defaultTitle: def.defaultTitle.trim() || fallbackTitle.trim() || "Pagamento",
    currency: def.currency.trim().toUpperCase() || fallbackCurrency.trim().toUpperCase() || "BRL",
  };
}

export function setStripeDefaultRow(rows: StripeCatalogRow[], id: string): StripeCatalogRow[] {
  return rows.map((r) => ({ ...r, isDefault: r.id === id }));
}

export function setMercadoPagoDefaultRow(rows: MercadoPagoCatalogRow[], id: string): MercadoPagoCatalogRow[] {
  return rows.map((r) => ({ ...r, isDefault: r.id === id }));
}
