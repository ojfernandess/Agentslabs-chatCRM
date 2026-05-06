import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import {
  PageTransition,
  motion,
  AnimatePresence,
  backdropVariants,
  modalVariants,
} from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { Briefcase, Plus, X, ListTree, Trash2 } from "lucide-react";
import clsx from "clsx";

interface StageItem {
  id: string;
  name: string;
  order: number;
  color: string;
}

interface DealRow {
  id: string;
  name: string;
  status: string;
  amountCents: number;
  currency: string;
  stage: { name: string; color: string };
  primaryContact: { id: string; name: string } | null;
}

interface LineItemRow {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPct: number;
  product: { id: string; name: string } | null;
}

interface DealDetail extends DealRow {
  lineItems: LineItemRow[];
}

interface ProductOption {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

function eurosToCents(raw: string): number {
  const n = Number.parseFloat(raw.replace(",", "."));
  if (Number.isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function centsToEurosInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function DealsPage() {
  const { t } = useI18n();
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [stages, setStages] = useState<StageItem[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStageId, setCreateStageId] = useState("");
  const [createAmount, setCreateAmount] = useState("");
  const [createError, setCreateError] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [lineUnitEur, setLineUnitEur] = useState("");
  const [lineDisc, setLineDisc] = useState("0");
  const [lineProductId, setLineProductId] = useState("");
  const [lineError, setLineError] = useState("");
  const [lineSubmitting, setLineSubmitting] = useState(false);

  const loadDeals = useCallback(async () => {
    const res = await api.get<{ data: DealRow[] }>("/crm/deals");
    setDeals(res.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadDeals();
        const st = await api.get<StageItem[]>("/crm/pipeline-stages");
        if (!cancelled) {
          setStages(st);
          if (st[0]) setCreateStageId(st[0].id);
        }
      } catch {
        if (!cancelled) {
          setDeals([]);
          setStages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDeals]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setLineError("");
    setDetailLoading(true);
    try {
      const [d, prodRes] = await Promise.all([
        api.get<DealDetail>(`/crm/deals/${id}`),
        api.get<{ data: ProductOption[] }>("/crm/products"),
      ]);
      setDetail(d);
      setProducts(prodRes.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
    setLineDesc("");
    setLineQty("1");
    setLineUnitEur("");
    setLineDisc("0");
    setLineProductId("");
  };

  const refreshDetailAndList = async (dealId: string) => {
    await loadDeals();
    if (detailId === dealId) {
      try {
        const d = await api.get<DealDetail>(`/crm/deals/${dealId}`);
        setDetail(d);
      } catch {
        /* ignore */
      }
    }
  };

  const handleCreateDeal = async () => {
    setCreateError("");
    if (!createName.trim()) {
      setCreateError("Indique o nome do negócio.");
      return;
    }
    if (!createStageId) {
      setCreateError("Não há etapas de pipeline disponíveis.");
      return;
    }
    setCreateSubmitting(true);
    try {
      const amountCents = createAmount.trim() ? eurosToCents(createAmount) : 0;
      await api.post("/crm/deals", {
        name: createName.trim(),
        stageId: createStageId,
        amountCents,
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateAmount("");
      await loadDeals();
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Não foi possível criar o negócio.");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleAddLine = async () => {
    if (!detailId || !detail) return;
    setLineError("");
    if (!lineDesc.trim()) {
      setLineError("Descrição obrigatória.");
      return;
    }
    const qty = Number.parseInt(lineQty, 10);
    if (Number.isNaN(qty) || qty < 1) {
      setLineError("Quantidade inválida.");
      return;
    }
    setLineSubmitting(true);
    try {
      await api.post(`/crm/deals/${detailId}/line-items`, {
        description: lineDesc.trim(),
        quantity: qty,
        unitPriceCents: lineUnitEur.trim() ? eurosToCents(lineUnitEur) : 0,
        discountPct: Number.parseInt(lineDisc, 10) || 0,
        productId: lineProductId || undefined,
      });
      setLineDesc("");
      setLineQty("1");
      setLineUnitEur("");
      setLineDisc("0");
      setLineProductId("");
      await refreshDetailAndList(detailId);
    } catch (e) {
      setLineError(e instanceof ApiError ? e.message : "Não foi possível adicionar a linha.");
    } finally {
      setLineSubmitting(false);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!detailId || !confirm("Remover esta linha?")) return;
    try {
      await api.delete(`/crm/deals/${detailId}/line-items/${lineId}`);
      await refreshDetailAndList(detailId);
    } catch {
      /* ignore */
    }
  };

  const fmtMoney = (cents: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

  const lineTotal = (row: LineItemRow) => {
    const factor = Math.max(0, 1 - row.discountPct / 100);
    return Math.round(row.quantity * row.unitPriceCents * factor);
  };

  return (
    <PageTransition>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Briefcase className="h-8 w-8 text-brand-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t("nav.deals")}</h1>
              <p className="text-sm text-gray-500">Oportunidades, linhas de produto e totais</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setCreateError("");
            }}
            disabled={stages.length === 0}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white",
              stages.length === 0
                ? "cursor-not-allowed bg-gray-400"
                : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            <Plus className="h-4 w-4" />
            Novo negócio
          </button>
        </div>

        {stages.length === 0 && !loading ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Não foi possível carregar etapas do pipeline. Confirme permissões ou crie etapas em{" "}
            <Link to="/crm" className="font-medium underline">
              Funil CRM
            </Link>
            .
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : deals.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-500">
            Nenhum negócio ainda. Use &quot;Novo negócio&quot; ou a API{" "}
            <code className="text-xs">POST /api/v1/crm/deals</code>.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Nome</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Etapa</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Estado</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">Valor</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">Contato</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">Linhas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {deals.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: d.stage.color }}
                        />
                        {d.stage.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{d.status}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-800">
                      {fmtMoney(d.amountCents, d.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {d.primaryContact ? (
                        <Link
                          to={`/contacts/${d.primaryContact.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {d.primaryContact.name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openDetail(d.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        <ListTree className="h-3.5 w-3.5" />
                        Gerir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AnimatePresence>
          {createOpen ? (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              initial="hidden"
              animate="show"
              exit="exit"
              variants={backdropVariants}
            >
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Fechar"
                onClick={() => setCreateOpen(false)}
              />
              <motion.div
                className="relative w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
                variants={modalVariants}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">Novo negócio</h2>
                  <button
                    type="button"
                    className="rounded p-1 text-gray-400 hover:bg-gray-100"
                    onClick={() => setCreateOpen(false)}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600">Nome</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="Ex.: Licença anual — Cliente X"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600">Etapa</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={createStageId}
                      onChange={(e) => setCreateStageId(e.target.value)}
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600">
                      Valor inicial (opcional, €)
                    </label>
                    <input
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={createAmount}
                      onChange={(e) => setCreateAmount(e.target.value)}
                      placeholder="0,00"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Ao adicionar linhas abaixo, o total do negócio passa a ser a soma das linhas.
                    </p>
                  </div>
                  {createError && <p className="text-sm text-red-600">{createError}</p>}
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      onClick={() => setCreateOpen(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={createSubmitting}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                      onClick={() => void handleCreateDeal()}
                    >
                      {createSubmitting ? "A guardar…" : "Criar"}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {detailId ? (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              initial="hidden"
              animate="show"
              exit="exit"
              variants={backdropVariants}
            >
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Fechar"
                onClick={closeDetail}
              />
              <motion.div
                className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl"
                variants={modalVariants}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-gray-900">
                      {detail?.name ?? "Negócio"}
                    </h2>
                    {detail && (
                      <p className="text-sm text-gray-500">
                        Total: {fmtMoney(detail.amountCents, detail.currency)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100"
                    onClick={closeDetail}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {detailLoading || !detail ? (
                  <div className="flex justify-center py-12">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
                  </div>
                ) : (
                  <>
                    <h3 className="mb-2 text-sm font-medium text-gray-700">Linhas</h3>
                    {detail.lineItems.length === 0 ? (
                      <p className="mb-4 text-sm text-gray-500">Sem linhas — o valor pode ser só o inicial.</p>
                    ) : (
                      <ul className="mb-4 space-y-2">
                        {detail.lineItems.map((row) => (
                          <li
                            key={row.id}
                            className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-gray-900">{row.description}</p>
                              <p className="text-xs text-gray-500">
                                {row.quantity} × {fmtMoney(row.unitPriceCents, detail.currency)}
                                {row.discountPct > 0 ? ` (−${row.discountPct}%)` : ""}
                                {row.product ? ` · ${row.product.name}` : ""}
                              </p>
                              <p className="text-xs font-medium text-gray-700">
                                Linha: {fmtMoney(lineTotal(row), detail.currency)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDeleteLine(row.id)}
                              className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                              title="Remover linha"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h3 className="mb-2 text-sm font-medium text-gray-700">Adicionar linha</h3>
                    <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                      <input
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        placeholder="Descrição"
                        value={lineDesc}
                        onChange={(e) => setLineDesc(e.target.value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Qtd</label>
                          <input
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={lineQty}
                            onChange={(e) => setLineQty(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Preço unit. (€)</label>
                          <input
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={lineUnitEur}
                            onChange={(e) => setLineUnitEur(e.target.value)}
                            placeholder="0,00"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500">Desconto %</label>
                          <input
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={lineDisc}
                            onChange={(e) => setLineDisc(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500">Produto (opcional)</label>
                          <select
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                            value={lineProductId}
                            onChange={(e) => {
                              const v = e.target.value;
                              setLineProductId(v);
                              const p = products.find((x) => x.id === v);
                              if (p) setLineUnitEur(centsToEurosInput(p.priceCents));
                            }}
                          >
                            <option value="">—</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {lineError && <p className="text-sm text-red-600">{lineError}</p>}
                      <button
                        type="button"
                        disabled={lineSubmitting}
                        className="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        onClick={() => void handleAddLine()}
                      >
                        {lineSubmitting ? "A adicionar…" : "Adicionar linha"}
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </PageTransition>
  );
}
