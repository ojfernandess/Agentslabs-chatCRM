import { useCallback, useEffect, useState } from "react";
import { Loader2, MoreHorizontal, Plus, RefreshCw, ExternalLink } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { deriveEvolutionApiUiState, type WhatsappConnectionUiState } from "@/lib/whatsappConnectionUiState";
import { WhatsappConnectionStatusBadge } from "./WhatsappConnectionStatusBadge";
import { WhatsappAdvancedSettingsPanel } from "./WhatsappAdvancedSettingsPanel";
import {
  WhatsappConnectionFlowModal,
  type ConnectionFlowStep,
} from "./WhatsappConnectionFlowModal";

interface Props {
  instanceName: string;
  platformQrMode: boolean;
  webhookUrl: string;
  webhookSecret: string;
  onWebhookSecretChange: (v: string) => void;
  webhookSecretStored: boolean;
  evolutionBaseUrl: string;
  onEvolutionBaseUrlChange: (v: string) => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  apiKeyStored: boolean;
  onInstanceNameChange: (v: string) => void;
  onCopyWebhook: () => void;
  webhookCopied: boolean;
  t: (key: string) => string;
}

export function EvolutionApiSettingsPanel({
  instanceName,
  platformQrMode,
  webhookUrl,
  webhookSecret,
  onWebhookSecretChange,
  webhookSecretStored,
  evolutionBaseUrl,
  onEvolutionBaseUrlChange,
  apiKey,
  onApiKeyChange,
  apiKeyStored,
  onInstanceNameChange,
  onCopyWebhook,
  webhookCopied,
  t,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connPoll, setConnPoll] = useState<{ connected: boolean; state: string } | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowStep, setFlowStep] = useState<ConnectionFlowStep>("name");
  const [flowName, setFlowName] = useState("");
  const [reconnectMode, setReconnectMode] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [webhookWarn, setWebhookWarn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const uiState: WhatsappConnectionUiState = deriveEvolutionApiUiState({
    configured: Boolean(instanceName?.trim()),
    connected: connPoll?.connected ?? false,
    state: connPoll?.state ?? "",
    hasError: Boolean(error) && !flowOpen,
  });

  const refreshStatus = useCallback(async () => {
    if (!platformQrMode) return;
    try {
      const s = await api.get<{ connected: boolean; state: string; instanceName?: string }>(
        "/settings/evolution-qr/status",
      );
      setConnPoll({ connected: s.connected, state: s.state });
      if (s.instanceName && !instanceName) onInstanceNameChange(s.instanceName);
    } catch {
      /* ignore poll errors */
    }
  }, [platformQrMode, instanceName, onInstanceNameChange]);

  useEffect(() => {
    if (!platformQrMode) return;
    void refreshStatus();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshStatus();
    }, 4000);
    return () => clearInterval(id);
  }, [platformQrMode, refreshStatus]);

  useEffect(() => {
    if (flowOpen && flowStep === "connect" && connPoll?.connected) {
      setFlowStep("done");
    }
  }, [flowOpen, flowStep, connPoll?.connected]);

  const startConnection = async (name?: string) => {
    setBusy(true);
    setError("");
    setWebhookWarn(false);
    try {
      const body = name?.trim() ? { instanceName: name.trim() } : {};
      const r = await api.post<{
        instanceName: string;
        pairingCode: string | null;
        qrDataUrl: string | null;
        connectionState: string;
        connected: boolean;
        webhookConfigured?: boolean;
      }>("/settings/evolution-qr/start", body);
      onInstanceNameChange(r.instanceName);
      setPairingCode(r.pairingCode);
      setQrDataUrl(r.qrDataUrl);
      setConnPoll({ connected: r.connected, state: r.connectionState });
      if (r.webhookConfigured === false) setWebhookWarn(true);
      setFlowStep(r.connected ? "done" : "connect");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.evolutionQrError"));
    } finally {
      setBusy(false);
    }
  };

  const refreshQr = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.get<{ pairingCode: string | null; qrDataUrl: string | null }>(
        "/settings/evolution-qr/qr",
      );
      setPairingCode(r.pairingCode);
      setQrDataUrl(r.qrDataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.evolutionQrError"));
    } finally {
      setBusy(false);
    }
  };

  const openAddFlow = () => {
    setReconnectMode(false);
    setFlowName("");
    setFlowStep("name");
    setQrDataUrl(null);
    setPairingCode(null);
    setError("");
    setFlowOpen(true);
  };

  const openReconnectFlow = async () => {
    setReconnectMode(true);
    setFlowStep("connect");
    setError("");
    setFlowOpen(true);
    setBusy(true);
    try {
      await startConnection(instanceName || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.evolutionQrError"));
    } finally {
      setBusy(false);
    }
  };

  const syncWebhook = async () => {
    setBusy(true);
    setError("");
    setWebhookWarn(false);
    try {
      const r = await api.post<{ ok: boolean; webhookUrl?: string; instanceName?: string }>(
        "/settings/evolution-qr/sync-webhook",
        {},
      );
      if (r.instanceName && r.instanceName !== instanceName) {
        onInstanceNameChange(r.instanceName);
      }
      if (!r.ok) setWebhookWarn(true);
    } catch (err) {
      setWebhookWarn(true);
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Falha ao sincronizar webhook");
    } finally {
      setBusy(false);
    }
  };

  if (!platformQrMode) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Evolution API</h3>
            <p className="mt-0.5 text-xs text-ink-500">Configure URL, API key e instância manualmente.</p>
          </div>
          <WhatsappConnectionStatusBadge
            state={instanceName?.trim() ? "configured_disconnected" : "not_configured"}
          />
        </div>
        <WhatsappAdvancedSettingsPanel
          webhookUrl={webhookUrl}
          webhookActive={Boolean(webhookUrl)}
          webhookSecret={webhookSecret}
          onWebhookSecretChange={onWebhookSecretChange}
          webhookSecretStored={webhookSecretStored}
          webhookSecretHint="Opcional — header x-openconduit-token para verificação extra."
          baseUrl={evolutionBaseUrl}
          onBaseUrlChange={onEvolutionBaseUrlChange}
          baseUrlLabel="Evolution API base URL"
          apiKey={apiKey}
          onApiKeyChange={onApiKeyChange}
          apiKeyStored={apiKeyStored}
          apiKeyLabel="API key"
          instanceId={instanceName}
          onInstanceIdChange={onInstanceNameChange}
          instanceLabel="Nome da instância"
          onCopyWebhook={onCopyWebhook}
          webhookCopied={webhookCopied}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status hero */}
      <div className="rounded-xl border border-ink-200/70 bg-ink-50/30 p-4 dark:border-soft-border dark:bg-black/15">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <WhatsappConnectionStatusBadge state={uiState} size="md" />
              {busy && !flowOpen ? <Loader2 className="h-4 w-4 animate-spin text-ink-400" /> : null}
            </div>
            {instanceName ? (
              <>
                <p className="mt-2 text-base font-semibold text-ink-900 dark:text-ink-50">{instanceName}</p>
                {connPoll?.state && !connPoll.connected ? (
                  <p className="mt-0.5 text-xs text-ink-500">
                    Estado: {connPoll.state || t("settings.evolutionQrNotConnected")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">
                Nenhuma instância ligada. Adicione uma conexão para começar.
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
            ) : uiState === "configured_disconnected" || uiState === "connecting" ? (
              <button
                type="button"
                onClick={() => void openReconnectFlow()}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Conectar WhatsApp
              </button>
            ) : uiState === "not_configured" ? (
              <button type="button" onClick={openAddFlow} className="btn-primary px-3 py-1.5 text-xs">
                Configurar
              </button>
            ) : null}

            {instanceName ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-lg border border-ink-200/80 p-1.5 text-ink-500 hover:bg-white dark:border-soft-border dark:hover:bg-white/5"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 z-10 mt-1 min-w-[160px] rounded-lg border border-ink-200/80 bg-white py-1 shadow-lg dark:border-soft-border dark:bg-[#1a2030]">
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
                        void syncWebhook();
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Sincronizar webhook
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

        {uiState === "configured_disconnected" && instanceName ? (
          <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-200">
            Sua conexão precisa ser autenticada novamente. Clique em <strong>Conectar WhatsApp</strong> para
            reconectar.
          </div>
        ) : null}

        {webhookWarn ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t("settings.evolutionQrWebhookWarn")}</p>
        ) : null}
      </div>

      {/* Webhook summary (not full URL) */}
      {instanceName ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 text-ink-600 dark:text-ink-400">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            Webhook ativo
          </div>
          <button
            type="button"
            onClick={() => setAdvancedOpen(true)}
            className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            Ver detalhes
          </button>
        </div>
      ) : null}

      {/* Connection info */}
      {instanceName ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Instância", value: instanceName },
            { label: "Provider", value: "Evolution API" },
            {
              label: "Estado",
              value: connPoll?.connected ? "Operacional" : connPoll?.state || "—",
            },
          ].map((row) => (
            <div key={row.label} className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{row.label}</p>
              <p className="mt-0.5 truncate text-sm font-medium text-ink-900 dark:text-ink-50">{row.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Secondary: add connection */}
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
        webhookActive={webhookWarn === false && Boolean(webhookUrl)}
        webhookSecret={webhookSecret}
        onWebhookSecretChange={onWebhookSecretChange}
        webhookSecretStored={webhookSecretStored}
        webhookSecretHint="Opcional — header x-openconduit-token."
        onCopyWebhook={onCopyWebhook}
        webhookCopied={webhookCopied}
        extra={
          pairingCode && !flowOpen ? (
            <p className="text-xs text-ink-500">
              {t("settings.evolutionQrPairing")}:{" "}
              <code className="font-mono">{pairingCode}</code>
            </p>
          ) : null
        }
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
        instanceName={instanceName || flowName}
        connectionState={uiState}
        busy={busy}
        error={error}
        nameValue={flowName}
        onNameChange={setFlowName}
        onCreateInstance={async () => {
          await startConnection(flowName);
          if (!connPoll?.connected) setFlowStep("connect");
        }}
        showQrOption
        showPairingOption={Boolean(pairingCode)}
        connectionMethod="qr"
        onSelectQr={() => setFlowStep("connect")}
        onSelectPairing={() => setFlowStep("connect")}
        qrDataUrl={qrDataUrl}
        pairingCode={pairingCode}
        onRefreshQr={() => void refreshQr()}
        step={flowStep}
      />
    </div>
  );
}
