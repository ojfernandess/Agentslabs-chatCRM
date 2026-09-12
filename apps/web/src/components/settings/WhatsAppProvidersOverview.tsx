import { ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import type { WhatsappProviderOverviewItem } from "@/lib/whatsappProvidersOverview";
import type { WhatsappConnectionUiState } from "@/lib/whatsappConnectionUiState";
import { WhatsappConnectionStatusBadge } from "./whatsapp/WhatsappConnectionStatusBadge";

interface Props {
  items: WhatsappProviderOverviewItem[];
  activeProvider: string;
  onSelectProvider: (provider: string) => void;
  connectionStatusByProvider?: Partial<Record<string, WhatsappConnectionUiState>>;
}

export function WhatsAppProvidersOverview({
  items,
  activeProvider,
  onSelectProvider,
  connectionStatusByProvider,
}: Props) {
  const evolutionProviders = items.filter((x) => x.id === "evolution" || x.id === "evolution_go");
  const cloudProviders = items.filter((x) => x.id === "meta" || x.id === "360dialog");
  const otherProviders = items.filter(
    (x) => !["evolution", "evolution_go", "meta", "360dialog"].includes(x.id),
  );

  const renderCard = (item: WhatsappProviderOverviewItem) => {
    const status =
      connectionStatusByProvider?.[item.id] ??
      (item.configured ? "configured_disconnected" : "not_configured");
    const isConnected = status === "connected";
    const active = activeProvider === item.id;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelectProvider(item.id)}
        className={clsx(
          "group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
          active
            ? "border-brand-400/80 bg-brand-50/40 dark:border-brand-700 dark:bg-brand-950/25"
            : "border-ink-200/70 bg-white hover:border-ink-300 hover:bg-ink-50/50 dark:border-soft-border dark:bg-black/10 dark:hover:border-white/15 dark:hover:bg-white/5",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{item.label}</p>
            {item.isPrimary ? (
              <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
                Principal
              </span>
            ) : null}
          </div>
          {item.inboxLabel ? (
            <p className="mt-0.5 truncate text-xs text-ink-500">{item.inboxLabel}</p>
          ) : null}
          <div className="mt-2">
            <WhatsappConnectionStatusBadge state={status} />
          </div>
          {item.configured && isConnected ? (
            <p className="mt-1.5 text-xs text-ink-500">1 conexão ativa</p>
          ) : item.configured && status === "configured_disconnected" ? (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">Aguardando conexão</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs font-medium text-brand-700 group-hover:underline dark:text-brand-300">
            {item.configured ? "Gerenciar" : "Configurar"}
          </span>
          <ChevronRight className="h-4 w-4 text-ink-300 dark:text-ink-600" />
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {evolutionProviders.length > 0 ? (
        <div className="space-y-2">{evolutionProviders.map(renderCard)}</div>
      ) : null}

      {cloudProviders.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">Cloud API</p>
          <div className="space-y-2">{cloudProviders.map(renderCard)}</div>
        </div>
      ) : null}

      {otherProviders.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">Outros</p>
          <div className="space-y-2">{otherProviders.map(renderCard)}</div>
        </div>
      ) : null}
    </div>
  );
}
