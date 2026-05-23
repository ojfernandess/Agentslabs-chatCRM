import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, RefreshCw, Wifi } from "lucide-react";
import { api, ApiError } from "@/lib/api";

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
}

export function EvolutionGoSettingsPanel({
  webhookUrl,
  savedInstanceId,
  platformMode,
  onInstanceIdChange,
  onProviderEnsureSaved,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [instances, setInstances] = useState<EvoGoInstance[]>([]);
  const [status, setStatus] = useState<EvoGoStatus | null>(null);
  const [webhookOk, setWebhookOk] = useState<boolean | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairPhone, setPairPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const hasInstance = Boolean(savedInstanceId?.trim());
  const isLinked = Boolean(status?.loggedIn);

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
    if (!hasInstance) return;
    void loadInstances();
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
  }, [hasInstance, loadInstances, refreshStatus]);

  const createInstance = async () => {
    const label = newName.trim();
    if (!label) return;
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
        { name: label },
      );
      onInstanceIdChange(r.instance.id);
      setNewName(r.instance.name);
      setWebhookOk(r.instance.webhookConfigured ? true : null);
      setQrDataUrl(null);
      setQrCode(null);
      setPairingCode(null);
      setStatus(null);
      await loadInstances();
      await refreshStatus();
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
        setQrCode(qr.code || null);
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
      setQrCode(qr.code || null);
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
    setQrCode(null);
    setPairingCode(null);
    setWebhookOk(null);
  };

  return (
    <div className="space-y-4 rounded-xl border border-brand-200/70 bg-gradient-to-br from-brand-50/50 to-white p-4 dark:border-brand-800/40 dark:from-brand-950/20 dark:to-[#111C2B]/55">
      <div>
        <h3 className="text-sm font-bold text-ink-900 dark:text-ink-50">Evolution Go</h3>
        <p className="mt-1 text-xs text-ink-600 dark:text-ink-400">
          {platformMode
            ? "Crie uma instância para esta organização, configure o webhook e ligue o WhatsApp com QR ou código de pareamento."
            : "Configure a URL do servidor, crie a instância e ligue o WhatsApp."}
        </p>
      </div>

      {webhookUrl ? (
        <p className="text-xs text-ink-600 dark:text-ink-400">
          Webhook: <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px] dark:bg-black/20">{webhookUrl}</code>
        </p>
      ) : null}

      {!hasInstance ? (
        <div className="rounded-lg border border-dashed border-ink-200 bg-white/80 p-4 dark:border-white/10 dark:bg-black/10">
          <p className="text-sm font-medium text-ink-900 dark:text-ink-50">1. Criar instância</p>
          <p className="mt-1 text-xs text-ink-500">Escolha um nome curto (ex.: vendas, suporte).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da instância"
              className="min-w-[200px] flex-1 input-field"
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy || !newName.trim()}
              onClick={() => void createInstance()}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "A criar…" : "Criar instância"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {instances.length > 0 ? (
            <div className="rounded-lg border border-ink-200/80 bg-white/90 p-3 dark:border-white/10 dark:bg-black/10">
              {isLinked && instances.length === 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Instância da organização</p>
                    <p className="mt-1 text-sm font-medium text-ink-900 dark:text-ink-50">{instances[0].name}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Ligada
                  </span>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Instâncias desta organização</p>
                  <ul className="mt-2 divide-y divide-ink-100 dark:divide-white/10">
                    {instances.map((inst) => (
                      <li key={inst.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        {instances.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => selectInstance(inst)}
                            className="font-medium text-ink-900 hover:underline dark:text-ink-50"
                          >
                            {inst.name}
                          </button>
                        ) : (
                          <span className="font-medium text-ink-900 dark:text-ink-50">{inst.name}</span>
                        )}
                        <div className="flex items-center gap-2 text-xs">
                          {inst.id === savedInstanceId ? (
                            <span className="rounded-full bg-brand-100 px-2 py-0.5 font-medium text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                              ativa
                            </span>
                          ) : null}
                          <span className={inst.connected ? "text-emerald-700" : "text-amber-700"}>
                            {inst.connected ? "online" : "offline"}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}

          <div className="rounded-lg border border-ink-200/80 bg-white/90 p-3 dark:border-white/10 dark:bg-black/10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-900 dark:text-ink-50">2. Webhook e ligação</p>
              {status ? (
                <span className="text-xs text-ink-600">
                  {status.loggedIn ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> WhatsApp ligado
                    </span>
                  ) : status.connected ? (
                    <span className="text-amber-700">Aguardando QR / pareamento</span>
                  ) : (
                    <span className="text-ink-500">Desligado</span>
                  )}
                </span>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void connectWebhook()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                Configurar webhook
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshStatus()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-white/10 dark:text-ink-200"
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar estado
              </button>
            </div>
            {webhookOk === true ? (
              <p className="mt-2 text-xs text-emerald-700">Webhook configurado no Evolution Go.</p>
            ) : webhookOk === false ? (
              <p className="mt-2 text-xs text-red-600">Falha ao configurar webhook.</p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-200/80 bg-white/90 p-3 dark:border-white/10 dark:bg-black/10">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900 dark:text-ink-50">
                <QrCode className="h-4 w-4" /> QR Code
              </p>
              {qrDataUrl ? (
                <div className="mt-2 flex justify-center">
                  <img src={qrDataUrl} alt="QR WhatsApp" className="h-44 w-44 rounded-lg border bg-white p-2" />
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-500">Configure o webhook e atualize o QR para ligar o telemóvel.</p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshQr()}
                className="mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
              >
                Atualizar QR
              </button>
              {qrCode ? (
                <p className="mt-1 break-all font-mono text-[10px] text-ink-500">{qrCode}</p>
              ) : null}
            </div>

            <div className="rounded-lg border border-ink-200/80 bg-white/90 p-3 dark:border-white/10 dark:bg-black/10">
              <p className="text-sm font-medium text-ink-900 dark:text-ink-50">Código de pareamento</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={pairPhone}
                  onChange={(e) => setPairPhone(e.target.value)}
                  placeholder="5511999999999"
                  className="min-w-[160px] flex-1 input-field text-sm"
                  disabled={busy}
                />
                <button
                  type="button"
                  disabled={busy || !pairPhone.trim()}
                  onClick={() => void requestPairing()}
                  className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium hover:bg-ink-50 dark:border-white/10"
                >
                  Gerar código
                </button>
              </div>
              {pairingCode ? (
                <p className="mt-2 font-mono text-lg font-bold tracking-widest text-ink-900 dark:text-ink-50">
                  {pairingCode}
                </p>
              ) : null}
            </div>
          </div>

          {!isLinked ? (
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nova instância (nome)"
                className="min-w-[160px] flex-1 input-field text-sm"
                disabled={busy}
              />
              <button
                type="button"
                disabled={busy || !newName.trim()}
                onClick={() => void createInstance()}
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium hover:bg-ink-50 dark:border-white/10"
              >
                Criar outra instância
              </button>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
