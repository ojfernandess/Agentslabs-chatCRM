import { useEffect, useState } from "react";
import { X, Loader2, QrCode, Smartphone, CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";
import { WhatsappConnectionStatusBadge } from "./WhatsappConnectionStatusBadge";
import type { WhatsappConnectionUiState } from "@/lib/whatsappConnectionUiState";

export type ConnectionFlowStep = "name" | "method" | "connect" | "done";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** When true, skip name step (reconnect existing instance). */
  reconnectMode?: boolean;
  instanceName?: string;
  connectionState: WhatsappConnectionUiState;
  busy?: boolean;
  error?: string;
  /** Step 1 */
  nameValue: string;
  onNameChange: (v: string) => void;
  onCreateInstance: () => Promise<void>;
  /** Step 2–3 */
  showQrOption?: boolean;
  showPairingOption?: boolean;
  onSelectQr: () => void;
  onSelectPairing: () => void;
  connectionMethod: "qr" | "pairing" | null;
  qrDataUrl?: string | null;
  pairingCode?: string | null;
  pairPhone?: string;
  onPairPhoneChange?: (v: string) => void;
  onRequestPairing?: () => void;
  onRefreshQr?: () => void;
  /** Current step controlled by parent after instance exists */
  step: ConnectionFlowStep;
  onStepChange?: (step: ConnectionFlowStep) => void;
}

const STEPS: ConnectionFlowStep[] = ["name", "method", "connect", "done"];

export function WhatsappConnectionFlowModal({
  open,
  onClose,
  title,
  reconnectMode,
  instanceName,
  connectionState,
  busy,
  error,
  nameValue,
  onNameChange,
  onCreateInstance,
  showQrOption = true,
  showPairingOption = true,
  onSelectQr,
  onSelectPairing,
  connectionMethod,
  qrDataUrl,
  pairingCode,
  pairPhone,
  onPairPhoneChange,
  onRequestPairing,
  onRefreshQr,
  step,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) setVisible(true);
  }, [open]);

  if (!open && !visible) return null;

  const stepIndex = STEPS.indexOf(step);
  const displaySteps = reconnectMode ? STEPS.filter((s) => s !== "name") : STEPS;

  return (
    <div
      className={clsx(
        "fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-connection-flow-title"
    >
      <div
        className={clsx(
          "absolute inset-0 bg-black/40 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <div
        className={clsx(
          "relative w-full max-w-lg rounded-2xl border border-ink-200/80 bg-white shadow-xl transition-all dark:border-soft-border dark:bg-[#1a2030]",
          open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 dark:border-white/10">
          <div>
            <h2 id="wa-connection-flow-title" className="text-base font-semibold text-ink-900 dark:text-ink-50">
              {title}
            </h2>
            {instanceName ? (
              <p className="mt-0.5 text-xs text-ink-500">{instanceName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700 dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="mb-4 flex items-center gap-1">
            {displaySteps.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-1">
                <div
                  className={clsx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    stepIndex >= STEPS.indexOf(s)
                      ? "bg-brand-600 text-white"
                      : "bg-ink-100 text-ink-500 dark:bg-white/10",
                  )}
                >
                  {i + 1}
                </div>
                {i < displaySteps.length - 1 ? (
                  <div
                    className={clsx(
                      "h-px flex-1",
                      stepIndex > STEPS.indexOf(s)
                        ? "bg-brand-400"
                        : "bg-ink-200 dark:bg-white/10",
                    )}
                  />
                ) : null}
              </div>
            ))}
          </div>

          {error ? (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          {step === "name" && !reconnectMode ? (
            <div className="space-y-3 pb-2">
              <label className="block text-sm font-medium text-ink-800 dark:text-ink-200">
                Nome da conexão
              </label>
              <input
                type="text"
                value={nameValue}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="ex.: vendas, suporte"
                className="input-field"
                disabled={busy}
                autoFocus
              />
              <p className="text-xs text-ink-500">Escolha um nome curto para identificar esta conexão.</p>
            </div>
          ) : null}

          {step === "method" ? (
            <div className="grid gap-2 pb-2 sm:grid-cols-2">
              {showQrOption ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onSelectQr}
                  className={clsx(
                    "flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors",
                    connectionMethod === "qr"
                      ? "border-brand-400 bg-brand-50/80 dark:border-brand-600 dark:bg-brand-950/30"
                      : "border-ink-200 hover:border-brand-200 dark:border-soft-border",
                  )}
                >
                  <QrCode className="h-6 w-6 text-brand-600" />
                  <span className="font-medium">QR Code</span>
                </button>
              ) : null}
              {showPairingOption ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onSelectPairing}
                  className={clsx(
                    "flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors",
                    connectionMethod === "pairing"
                      ? "border-brand-400 bg-brand-50/80 dark:border-brand-600 dark:bg-brand-950/30"
                      : "border-ink-200 hover:border-brand-200 dark:border-soft-border",
                  )}
                >
                  <Smartphone className="h-6 w-6 text-brand-600" />
                  <span className="font-medium">Código de pareamento</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {step === "connect" ? (
            <div className="space-y-4 pb-2">
              <div className="flex items-center justify-between gap-2">
                <WhatsappConnectionStatusBadge state={connectionState} size="md" />
                {connectionState === "connecting" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                ) : null}
              </div>

              {connectionMethod === "qr" || (!connectionMethod && qrDataUrl) ? (
                <div className="flex flex-col items-center gap-3 py-2">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="QR WhatsApp"
                      className="h-48 w-48 rounded-xl border border-ink-200 bg-white p-2 dark:border-soft-border"
                    />
                  ) : (
                    <div className="flex h-48 w-48 items-center justify-center rounded-xl border border-dashed border-ink-200 dark:border-soft-border">
                      {busy ? (
                        <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
                      ) : (
                        <QrCode className="h-10 w-10 text-ink-300" />
                      )}
                    </div>
                  )}
                  <p className="text-center text-sm text-ink-600 dark:text-ink-400">
                    Abra o WhatsApp no telemóvel e escaneie o QR Code.
                  </p>
                  {onRefreshQr ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={onRefreshQr}
                      className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                    >
                      Atualizar QR
                    </button>
                  ) : null}
                </div>
              ) : null}

              {connectionMethod === "pairing" ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pairPhone ?? ""}
                      onChange={(e) => onPairPhoneChange?.(e.target.value)}
                      placeholder="5511999999999"
                      className="input-field flex-1 text-sm"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      disabled={busy || !pairPhone?.trim()}
                      onClick={onRequestPairing}
                      className="btn-secondary px-3 py-2 text-sm"
                    >
                      Gerar
                    </button>
                  </div>
                  {pairingCode ? (
                    <p className="text-center font-mono text-2xl font-bold tracking-[0.3em] text-ink-900 dark:text-ink-50">
                      {pairingCode}
                    </p>
                  ) : null}
                  <p className="text-xs text-ink-500">
                    No WhatsApp: Dispositivos conectados → Conectar dispositivo → Conectar com número.
                  </p>
                </div>
              ) : null}

              {connectionState === "connected" ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  WhatsApp conectado com sucesso.
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "done" ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="text-sm font-medium text-ink-900 dark:text-ink-50">Conexão confirmada</p>
              <p className="text-xs text-ink-500">O WhatsApp está pronto para receber e enviar mensagens.</p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-4 dark:border-white/10">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            {step === "done" || connectionState === "connected" ? "Fechar" : "Cancelar"}
          </button>
          {step === "name" && !reconnectMode ? (
            <button
              type="button"
              disabled={busy || !nameValue.trim()}
              onClick={() => void onCreateInstance()}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
                  A criar…
                </>
              ) : (
                "Continuar"
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
