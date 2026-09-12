import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { deriveEvolutionGoUiState, type WhatsappConnectionUiState } from "@/lib/whatsappConnectionUiState";
import { WhatsappConnectionStatusBadge } from "./whatsapp/WhatsappConnectionStatusBadge";
import { WhatsappAdvancedSettingsPanel } from "./whatsapp/WhatsappAdvancedSettingsPanel";
import {
  WhatsappConnectionFlowModal,
  type ConnectionFlowStep,
} from "./whatsapp/WhatsappConnectionFlowModal";

type EvoGoInstance = { id: string; name: string; connected: boolean; selected?: boolean };
type EvoGoStatus = {
  connected: boolean;
  loggedIn: boolean;
  name: string;
  unreachable?: boolean;
};

interface Props {
  webhookUrl: string;
  savedInstanceId: string;
  platformMode: boolean;
  onInstanceIdChange: (id: string) => void;
  onProviderEnsureSaved: () => Promise<boolean>;
  webhookSecret?: string;
  onWebhookSecretChange?: (v: string) => void;
  webhookSecretStored?: boolean;
  evolutionBaseUrl?: string;
  onEvolutionBaseUrlChange?: (v: string) => void;
  apiKey?: string;
  onApiKeyChange?: (v: string) => void;
  apiKeyStored?: boolean;
  onCopyWebhook?: () => void;
  webhookCopied?: boolean;
}

export function EvolutionGoSettingsPanel({
  webhookUrl,
  savedInstanceId,
  platformMode,
  onInstanceIdChange,
  onProviderEnsureSaved,
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
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [instances, setInstances] = useState<EvoGoInstance[]>([]);
  const [status, setStatus] = useState<EvoGoStatus | null>(null);
  const [webhookOk, setWebhookOk] = useState<boolean | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairPhone, setPairPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowStep, setFlowStep] = useState<ConnectionFlowStep>("name");
  const [flowName, setFlowName] = useState("");
  const [reconnectMode, setReconnectMode] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState<"qr" | "pairing" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const hasInstance = Boolean(savedInstanceId?.trim());
  const activeInstance = instances.find((i) => i.id === savedInstanceId) ?? instances[0];
  const displayName = status?.name || activeInstance?.name || savedInstanceId;

  const uiState: WhatsappConnectionUiState = deriveEvolutionGoUiState({
    hasInstance,
    status,
    hasError: Boolean(error) && !flowOpen,
  });

  const loadInstances = useCallback(async () => {
    try {
      const r = await api.get<{ instances: EvoGoInstance[]; selectedInstance?: string | null }>(
        "/settings/evolution-go/instances",
      );
      setInstances(r.instances ?? []);
      if (!savedInstanceId && r.selectedInstance) {
        onInstanceIdChange(r.selectedInstance);
      }
    } catch {
      setInstances([]);
    }
  }, [savedInstanceId, onInstanceIdChange]);

  const refreshStatus = useCallback(async () => {
    if (!hasInstance) {
      setStatus(null);
      return;
    }
    try {
      const st = await api.get<EvoGoStatus>("/settings/evolution-go/status");
      setStatus(st);
    } catch {
      setStatus({ connected: false, loggedIn: false, name: "", unreachable: true });
    }
  }, [hasInstance]);

  useEffect(() => {
    if (hasInstance) void loadInstances();
  }, [hasInstance, loadInstances]);

  useEffect(() => {
    if (!hasInstance) return;
    void refreshStatus();
    const poll = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    const id = window.setInterval(poll, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [hasInstance, refreshStatus]);

  useEffect(() => {
    if (flowOpen && flowStep === "connect" && status?.loggedIn) {
      setFlowStep("done");
    }
  }, [flowOpen, flowStep, status?.loggedIn]);

  const createInstance = async (label: string) => {
    const name = label.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    setWebhookOk(null);
    try {
      if (!(await onProviderEnsureSaved())) {
        setError("Guarde Evolution Go como provider antes de continuar.");
        return;
      }
      const r = await api.post<{ instance: { id: string; name: string; webhookConfigured?: boolean } }>(
        "/settings/evolution-go/create",
        { name },
      );
      onInstanceIdChange(r.instance.id);
      setWebhookOk(r.instance.webhookConfigured ? true : null);
      setQrDataUrl(null);
      setPairingCode(null);
      setStatus(null);
      await loadInstances();
      setFlowStep("method");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar instância");
    } finally {
      setBusy(false);
    }
  };

  const connectWebhook = async () => {
    setBusy(true);
    setError("");
    setWebhookOk(null);
    try {
      if (!(await onProviderEnsureSaved())) {
        setError("Guarde Evolution Go como provider antes de continuar.");
        return;
      }
      await api.post("/settings/evolution-go/connect", {});
      setWebhookOk(true);
      try {
        const qr = await api.get<{ qrDataUrl: string; code: string }>("/settings/evolution-go/qr");
        setQrDataUrl(qr.qrDataUrl || null);
      } catch {
        /* QR may be unavailable when already logged in */
      }
      await refreshStatus();
    } catch (err) {
      setWebhookOk(false);
      setError(err instanceof ApiError ? err.message : "Falha ao configurar webhook");
    } finally {
      setBusy(false);
    }
  };

  const refreshQr = async () => {
    setBusy(true);
    setError("");
    try {
      const qr = await api.get<{ qrDataUrl: string; code: string }>("/settings/evolution-go/qr");
      setQrDataUrl(qr.qrDataUrl || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao obter QR");
    } finally {
      setBusy(false);
    }
  };

  const requestPairing = async () => {
    const phone = pairPhone.trim();
    if (!phone) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ pairingCode: string }>("/settings/evolution-go/pair", { phone });
      setPairingCode(r.pairingCode || null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao gerar código de pareamento");
    } finally {
      setBusy(false);
    }
  };

  const selectInstance = (inst: EvoGoInstance) => {
    onInstanceIdChange(inst.id);
    setStatus(null);
    setQrDataUrl(null);
    setPairingCode(null);
    setWebhookOk(null);
  };

  const openAddFlow = () => {
    setReconnectMode(false);
    setFlowName("");
    setFlowStep("name");
    setConnectionMethod(null);
    setQrDataUrl(null);
    setPairingCode(null);
    setError("");
    setFlowOpen(true);
  };

  const openReconnectFlow = async () => {
    setReconnectMode(true);
    setConnectionMethod(null);
    setFlowStep("method");
    setError("");
    setFlowOpen(true);
  };

  const beginConnection = async (method: "qr" | "pairing") => {
    setConnectionMethod(method);
    setFlowStep("connect");
    setBusy(true);
    setError("");
    try {
      await connectWebhook();
      if (method === "qr") await refreshQr();
    } finally {
      setBusy(false);
    }
  };

  if (!platformMode) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Evolution Go</h3>
            <p className="mt-0.5 text-xs text-ink-500">Configure URL, token e instância manualmente.</p>
          </div>
          <WhatsappConnectionStatusBadge state={hasInstance ? uiState : "not_configured"} />
        </div>
        <WhatsappAdvancedSettingsPanel
          webhookUrl={webhookUrl}
          webhookActive={webhookOk}
          webhookSecret={webhookSecret}
          onWebhookSecretChange={onWebhookSecretChange}
          webhookSecretStored={webhookSecretStored}
          baseUrl={evolutionBaseUrl}
          onBaseUrlChange={onEvolutionBaseUrlChange}
          baseUrlLabel="Evolution Go base URL"
          apiKey={apiKey}
          onApiKeyChange={onApiKeyChange}
          apiKeyStored={apiKeyStored}
          instanceId={savedInstanceId}
          onInstanceIdChange={onInstanceIdChange}
          onCopyWebhook={onCopyWebhook}
          webhookCopied={webhookCopied}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-ink-200/70 bg-ink-50/30 p-4 dark:border-soft-border dark:bg-black/15">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <WhatsappConnectionStatusBadge state={hasInstance ? uiState : "not_configured"} size="md" />
              {busy && !flowOpen ? <Loader2 className="h-4 w-4 animate-spin text-ink-400" /> : null}
            </div>
            {hasInstance ? (
              <>
                <p className="mt-2 text-base font-semibold text-ink-900 dark:text-ink-50">{displayName}</p>
                {instances.length > 1 ? (
                  <p className="mt-0.5 text-xs text-ink-500">{instances.length} conexões nesta organização</p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">
                Nenhuma instância criada. Adicione uma conexão para começar.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {uiState === "connected" ? (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200/80 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-white dark:border-soft-border dark:text-ink-200 dark:hover:bg-white/5"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => void openReconnectFlow()}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  Reconectar
                </button>
              </>
            ) : hasInstance && (uiState === "configured_disconnected" || uiState === "connecting") ? (
              <button
                type="button"
                onClick={() => void openReconnectFlow()}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Conectar WhatsApp
              </button>
            ) : !hasInstance ? (
              <button type="button" onClick={openAddFlow} className="btn-primary px-3 py-1.5 text-xs">
                Configurar
              </button>
            ) : null}

            {hasInstance ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-lg border border-ink-200/80 p-1.5 text-ink-500 hover:bg-white dark:border-soft-border dark:hover:bg-white/5"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 z-10 mt-1 min-w-[180px] rounded-lg border border-ink-200/80 bg-white py-1 shadow-lg dark:border-soft-border dark:bg-[#1a2030]">
                    {instances.length > 1
                      ? instances.map((inst) => (
                          <button
                            key={inst.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5"
                            onClick={() => {
                              setMenuOpen(false);
                              selectInstance(inst);
                            }}
                          >
                            <span>{inst.name}</span>
                            {inst.id === savedInstanceId ? (
                              <span className="text-brand-600">ativa</span>
                            ) : null}
                          </button>
                        ))
                      : null}
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5"
                      onClick={() => {
                        setMenuOpen(false);
                        void refreshStatus();
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Atualizar estado
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5"
                      onClick={() => {
                        setMenuOpen(false);
                        openAddFlow();
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar conexão
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {uiState === "configured_disconnected" && hasInstance ? (
          <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200">
            Sua conexão precisa ser autenticada novamente. Clique em <strong>Conectar WhatsApp</strong>.
          </div>
        ) : null}
      </div>

      {hasInstance ? (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 text-ink-600 dark:text-ink-400">
              <span
                className={`inline-flex h-2 w-2 rounded-full ${webhookOk === false ? "bg-amber-500" : "bg-emerald-500"}`}
              />
              {webhookOk === false ? "Webhook pendente" : "Webhook ativo"}
            </div>
            <button
              type="button"
              onClick={() => setAdvancedOpen(true)}
              className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Ver detalhes
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Instância", value: displayName },
              { label: "Provider", value: "Evolution Go" },
              {
                label: "Estado",
                value: status?.loggedIn ? "Operacional" : status?.connected ? "Aguardando QR" : "Desligado",
              },
            ].map((row) => (
              <div key={row.label} className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{row.label}</p>
                <p className="mt-0.5 truncate text-sm font-medium text-ink-900 dark:text-ink-50">{row.value}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {uiState === "connected" ? (
        <button
          type="button"
          onClick={openAddFlow}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar conexão
        </button>
      ) : null}

      <WhatsappAdvancedSettingsPanel
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        webhookUrl={webhookUrl}
        webhookActive={webhookOk !== false}
        webhookSecret={webhookSecret}
        onWebhookSecretChange={onWebhookSecretChange}
        webhookSecretStored={webhookSecretStored}
        webhookSecretHint="Opcional — token da instância ou header x-openconduit-token."
        onCopyWebhook={onCopyWebhook}
        webhookCopied={webhookCopied}
      />

      {error && !flowOpen ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <WhatsappConnectionFlowModal
        open={flowOpen}
        onClose={() => setFlowOpen(false)}
        title={reconnectMode ? "Reconectar WhatsApp" : "Adicionar conexão"}
        reconnectMode={reconnectMode}
        instanceName={displayName || flowName}
        connectionState={uiState}
        busy={busy}
        error={error}
        nameValue={flowName}
        onNameChange={setFlowName}
        onCreateInstance={async () => {
          await createInstance(flowName);
        }}
        showQrOption
        showPairingOption
        connectionMethod={connectionMethod}
        onSelectQr={() => void beginConnection("qr")}
        onSelectPairing={() => void beginConnection("pairing")}
        qrDataUrl={qrDataUrl}
        pairingCode={pairingCode}
        pairPhone={pairPhone}
        onPairPhoneChange={setPairPhone}
        onRequestPairing={() => void requestPairing()}
        onRefreshQr={() => void refreshQr()}
        step={flowStep}
      />
    </div>
  );
}
