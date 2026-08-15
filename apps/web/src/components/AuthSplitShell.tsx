import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";

/**
 * Shell de autenticação com split 50/50 responsivo.
 * Abaixo de md: empilha (foto com altura limitada + formulário).
 * md+: colunas iguais (w-1/2) com altura fixa da viewport (h-dvh),
 * para a foto cobrir a página inteira em notebooks e desktops.
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="relative flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      <div className="relative h-[min(36vh,15rem)] w-full shrink-0 overflow-hidden bg-ink-900 sm:h-[min(40vh,18rem)] md:h-full md:w-1/2 md:min-w-0 md:shrink-0">
        <img
          src={brandAssetUrl("/bg-login.png")}
          alt=""
          className="absolute inset-0 size-full object-cover object-[center_18%] md:object-[30%_center] lg:object-[32%_center]"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-black/10 md:bg-gradient-to-r md:from-black/35 md:to-black/5" />
      </div>

      <div className="relative z-10 flex w-full min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-ink-50 px-4 py-8 dark:bg-ink-950 md:h-full md:w-1/2 md:shrink-0 md:bg-transparent md:px-6 md:py-10 lg:px-10 lg:py-12 dark:md:bg-transparent">
        <div className="flex w-full max-w-md flex-col items-center">
          {children}
          <p className="mt-6 max-w-md text-center text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            {t("login.developedBy")}{" "}
            <a
              href={VENDOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
            >
              {VENDOR_NAME}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
