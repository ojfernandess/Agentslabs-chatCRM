import { ChevronDown, Copy, Check, Webhook, Key, Server, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";
import { clsx } from "clsx";

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  webhookUrl?: string;
  webhookActive?: boolean | null;
  webhookSecret?: string;
  onWebhookSecretChange?: (v: string) => void;
  webhookSecretStored?: boolean;
  webhookSecretHint?: string;
  baseUrl?: string;
  onBaseUrlChange?: (v: string) => void;
  baseUrlLabel?: string;
  baseUrlHint?: string;
  apiKey?: string;
  onApiKeyChange?: (v: string) => void;
  apiKeyLabel?: string;
  apiKeyHint?: string;
  apiKeyStored?: boolean;
  instanceId?: string;
  onInstanceIdChange?: (v: string) => void;
  instanceLabel?: string;
  extra?: ReactNode;
  onCopyWebhook?: () => void;
  webhookCopied?: boolean;
}

export function WhatsappAdvancedSettingsPanel({
  open: controlledOpen,
  onOpenChange,
  webhookUrl,
  webhookActive,
  webhookSecret,
  onWebhookSecretChange,
  webhookSecretStored,
  webhookSecretHint,
  baseUrl,
  onBaseUrlChange,
  baseUrlLabel,
  baseUrlHint,
  apiKey,
  onApiKeyChange,
  apiKeyLabel,
  apiKeyHint,
  apiKeyStored,
  instanceId,
  onInstanceIdChange,
  instanceLabel,
  extra,
  onCopyWebhook,
  webhookCopied,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setInternalOpen(v);
  };

  return (
    <div className="border-t border-ink-200/60 pt-4 dark:border-white/10">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-ink-700 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-50"
      >
        <span>Configurações avançadas</span>
        <ChevronDown className={clsx("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="mt-4 space-y-4">
          {webhookUrl ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
                <Webhook className="h-3.5 w-3.5" />
                Webhook
                {webhookActive === true ? (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    Ativo
                  </span>
                ) : webhookActive === false ? (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    Pendente
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded-lg bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700 dark:bg-black/20 dark:text-ink-300">
                  {webhookUrl}
                </code>
                {onCopyWebhook ? (
                  <button
                    type="button"
                    onClick={onCopyWebhook}
                    className="rounded-lg border border-ink-200/80 p-2 text-ink-500 hover:bg-ink-50 dark:border-soft-border dark:hover:bg-white/5"
                  >
                    {webhookCopied ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {onWebhookSecretChange ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
                <Shield className="h-3.5 w-3.5" />
                Segurança
              </div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                Webhook secret
              </label>
              <input
                type="password"
                value={webhookSecret ?? ""}
                onChange={(e) => onWebhookSecretChange(e.target.value)}
                placeholder={webhookSecretStored ? "••••••••" : "Opcional"}
                className="input-field text-sm"
              />
              {webhookSecretHint ? (
                <p className="text-xs text-ink-500 dark:text-ink-400">{webhookSecretHint}</p>
              ) : null}
            </section>
          ) : null}

          {onBaseUrlChange && baseUrl !== undefined ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
                <Server className="h-3.5 w-3.5" />
                API
              </div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                {baseUrlLabel ?? "Base URL"}
              </label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => onBaseUrlChange(e.target.value)}
                className="input-field text-sm"
              />
              {baseUrlHint ? (
                <p className="text-xs text-ink-500 dark:text-ink-400">{baseUrlHint}</p>
              ) : null}
            </section>
          ) : null}

          {onApiKeyChange && apiKey !== undefined ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
                <Key className="h-3.5 w-3.5" />
                Token
              </div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                {apiKeyLabel ?? "API key"}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder={apiKeyStored ? "••••••••" : "Enter API key"}
                className="input-field text-sm"
              />
              {apiKeyHint ? (
                <p className="text-xs text-ink-500 dark:text-ink-400">{apiKeyHint}</p>
              ) : null}
            </section>
          ) : null}

          {onInstanceIdChange && instanceId !== undefined ? (
            <section className="space-y-2">
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400">
                {instanceLabel ?? "Instância"}
              </label>
              <input
                type="text"
                value={instanceId}
                onChange={(e) => onInstanceIdChange(e.target.value)}
                className="input-field font-mono text-sm"
              />
            </section>
          ) : null}

          {extra}
        </div>
      ) : null}
    </div>
  );
}
