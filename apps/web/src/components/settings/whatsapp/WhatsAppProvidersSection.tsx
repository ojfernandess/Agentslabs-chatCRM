import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { clsx } from "clsx";
import { api } from "@/lib/api";
import type { WhatsappProviderOverviewItem } from "@/lib/whatsappProvidersOverview";
import {
  deriveEvolutionApiUiState,
  deriveEvolutionGoUiState,
  type WhatsappConnectionUiState,
} from "@/lib/whatsappConnectionUiState";
import { WhatsAppProvidersOverview } from "../WhatsAppProvidersOverview";
import { EvolutionApiSettingsPanel } from "./EvolutionApiSettingsPanel";
import { EvolutionGoSettingsPanel } from "../EvolutionGoSettingsPanel";
import { whatsappProviderLabel } from "@/lib/whatsappOrgConfig";

interface Props {
  items: WhatsappProviderOverviewItem[];
  activeProvider: string;
  onSelectProvider: (provider: string) => void;
  evolutionPlatformQrMode: boolean;
  evolutionGoPlatformMode: boolean;
  instanceName: string;
  onInstanceNameChange: (v: string) => void;
  webhookUrl: string;
  evolutionGoWebhookUrl: string;
  webhookSecret: string;
  onWebhookSecretChange: (v: string) => void;
  webhookSecretStored: boolean;
  evolutionBaseUrl: string;
  onEvolutionBaseUrlChange: (v: string) => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  apiKeyStored: boolean;
  onCopyWebhook: () => void;
  webhookCopied: boolean;
  ensureEvolutionGoProviderSaved: () => Promise<boolean>;
  persistEvolutionGoInstanceId: (id: string) => void;
  t: (key: string) => string;
}

export function WhatsAppProvidersSection({
  items,
  activeProvider,
  onSelectProvider,
  evolutionPlatformQrMode,
  evolutionGoPlatformMode,
  instanceName,
  onInstanceNameChange,
  webhookUrl,
  evolutionGoWebhookUrl,
  webhookSecret,
  onWebhookSecretChange,
  webhookSecretStored,
  evolutionBaseUrl,
  onEvolutionBaseUrlChange,
  apiKey,
  onApiKeyChange,
  apiKeyStored,
  onCopyWebhook,
  webhookCopied,
  ensureEvolutionGoProviderSaved,
  persistEvolutionGoInstanceId,
  t,
}: Props) {
  const [view, setView] = useState<"list" | "detail">("list");
  const [statusByProvider, setStatusByProvider] = useState<
    Partial<Record<string, WhatsappConnectionUiState>>
  >({});

  const refreshProviderStatuses = useCallback(async () => {
    const next: Partial<Record<string, WhatsappConnectionUiState>> = {};

    const evoItem = items.find((i) => i.id === "evolution");
    if (evoItem?.configured && evolutionPlatformQrMode) {
      try {
        const s = await api.get<{ connected: boolean; state: string }>("/settings/evolution-qr/status");
        next.evolution = deriveEvolutionApiUiState({
          configured: true,
          connected: s.connected,
          state: s.state,
        });
      } catch {
        next.evolution = "configured_disconnected";
      }
    } else if (evoItem?.configured) {
      next.evolution = "configured_disconnected";
    } else {
      next.evolution = "not_configured";
    }

    const evoGoItem = items.find((i) => i.id === "evolution_go");
    if (evoGoItem?.configured && instanceName?.trim()) {
      try {
        const st = await api.get<{ connected: boolean; loggedIn: boolean; unreachable?: boolean }>(
          "/settings/evolution-go/status",
        );
        next.evolution_go = deriveEvolutionGoUiState({
          hasInstance: true,
          status: st,
        });
      } catch {
        next.evolution_go = "error";
      }
    } else if (evoGoItem?.configured) {
      next.evolution_go = "configured_disconnected";
    } else {
      next.evolution_go = "not_configured";
    }

    for (const item of items) {
      if (item.id === "evolution" || item.id === "evolution_go") continue;
      next[item.id] = item.configured ? "connected" : "not_configured";
    }

    setStatusByProvider(next);
  }, [items, evolutionPlatformQrMode, instanceName]);

  useEffect(() => {
    void refreshProviderStatuses();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshProviderStatuses();
    }, 15_000);
    return () => clearInterval(id);
  }, [refreshProviderStatuses]);

  const openDetail = (providerId: string) => {
    onSelectProvider(providerId);
    setView("detail");
  };

  const isEvolutionDetail =
    view === "detail" && (activeProvider === "evolution" || activeProvider === "evolution_go");

  return (
    <div className="card-surface rounded-xl p-6">
      {view === "list" ? (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink-900 dark:text-ink-50">Provedores WhatsApp</h2>
              <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
                Gerencie conexões, status e configurações dos providers WhatsApp da organização.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (activeProvider === "evolution" || activeProvider === "evolution_go") {
                  setView("detail");
                } else {
                  onSelectProvider("evolution_go");
                  setView("detail");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200/80 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50 dark:border-soft-border dark:text-ink-300 dark:hover:bg-white/5"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar conexão
            </button>
          </div>

          <WhatsAppProvidersOverview
            items={items}
            activeProvider={activeProvider}
            onSelectProvider={openDetail}
            connectionStatusByProvider={statusByProvider}
          />
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setView("list")}
            className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-brand-700 dark:hover:text-brand-300"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Provedores
            <span className="text-ink-300 dark:text-ink-600">/</span>
            <span className="text-ink-800 dark:text-ink-200">
              {whatsappProviderLabel(activeProvider) || activeProvider}
            </span>
          </button>

          <div className={clsx(!isEvolutionDetail && "space-y-4")}>
            {activeProvider === "evolution" ? (
              <EvolutionApiSettingsPanel
                instanceName={instanceName}
                platformQrMode={evolutionPlatformQrMode}
                webhookUrl={webhookUrl}
                webhookSecret={webhookSecret}
                onWebhookSecretChange={onWebhookSecretChange}
                webhookSecretStored={webhookSecretStored}
                evolutionBaseUrl={evolutionBaseUrl}
                onEvolutionBaseUrlChange={onEvolutionBaseUrlChange}
                apiKey={apiKey}
                onApiKeyChange={onApiKeyChange}
                apiKeyStored={apiKeyStored}
                onInstanceNameChange={onInstanceNameChange}
                onCopyWebhook={onCopyWebhook}
                webhookCopied={webhookCopied}
                t={t}
              />
            ) : activeProvider === "evolution_go" ? (
              <EvolutionGoSettingsPanel
                webhookUrl={evolutionGoWebhookUrl}
                savedInstanceId={instanceName}
                platformMode={evolutionGoPlatformMode}
                onInstanceIdChange={(id) => persistEvolutionGoInstanceId(id)}
                onProviderEnsureSaved={ensureEvolutionGoProviderSaved}
                webhookSecret={webhookSecret}
                onWebhookSecretChange={onWebhookSecretChange}
                webhookSecretStored={webhookSecretStored}
                evolutionBaseUrl={evolutionBaseUrl}
                onEvolutionBaseUrlChange={onEvolutionBaseUrlChange}
                apiKey={apiKey}
                onApiKeyChange={onApiKeyChange}
                apiKeyStored={apiKeyStored}
                onCopyWebhook={onCopyWebhook}
                webhookCopied={webhookCopied}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500 dark:border-soft-border">
                <p>
                  Configuração de <strong>{whatsappProviderLabel(activeProvider)}</strong> disponível em
                  credenciais avançadas abaixo.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    document.getElementById("whatsapp-manual-setup")?.scrollIntoView({ behavior: "smooth" });
                    const el = document.getElementById("whatsapp-manual-setup") as HTMLDetailsElement | null;
                    if (el) el.open = true;
                  }}
                  className="mt-3 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Abrir credenciais avançadas
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
