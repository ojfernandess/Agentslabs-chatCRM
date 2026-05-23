import { CheckCircle2, Circle } from "lucide-react";
import { clsx } from "clsx";
import type { WhatsappProviderOverviewItem } from "@/lib/whatsappProvidersOverview";

interface Props {
  items: WhatsappProviderOverviewItem[];
  activeProvider: string;
  onSelectProvider: (provider: string) => void;
}

export function WhatsAppProvidersOverview({ items, activeProvider, onSelectProvider }: Props) {
  const configured = items.filter((x) => x.configured);
  const unconfigured = items.filter((x) => !x.configured);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">Providers WhatsApp</p>
        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
          Providers com credenciais gravadas nesta organização. Selecione um para editar; o marcado como principal é o
          ativo nas definições do canal.
        </p>
      </div>

      {configured.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {configured.map((item) => {
            const active = activeProvider === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectProvider(item.id)}
                className={clsx(
                  "rounded-xl border p-3 text-left transition-colors",
                  active
                    ? "border-brand-400 bg-brand-50/80 ring-1 ring-brand-400/60 dark:border-brand-600 dark:bg-brand-950/40"
                    : "border-ink-200/80 bg-white hover:border-brand-200 hover:bg-brand-50/30 dark:border-white/10 dark:bg-black/10 dark:hover:border-brand-800",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{item.label}</p>
                    {item.inboxLabel ? (
                      <p className="mt-0.5 truncate text-xs text-ink-500">{item.inboxLabel}</p>
                    ) : null}
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.isPrimary ? (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
                      Principal
                    </span>
                  ) : null}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Configurado
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-ink-200 px-3 py-4 text-sm text-ink-500 dark:border-white/10">
          Nenhum provider configurado ainda. Escolha um tipo abaixo para começar.
        </p>
      )}

      {unconfigured.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">Adicionar provider</p>
          <div className="flex flex-wrap gap-2">
            {unconfigured.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectProvider(item.id)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  activeProvider === item.id
                    ? "border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-100"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:text-ink-300",
                )}
              >
                <Circle className="h-3 w-3" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
