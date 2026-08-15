import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";

/**
 * Shell de autenticação (login / reset / invite).
 * Em viewports < xl empilha a foto com altura controlada (evita corte agressivo).
 * Em xl+ a foto ocupa o espaço restante e o formulário fica com largura fixa —
 * 50/50 em monitores estreitos cortava o sujeito com object-cover.
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="relative flex min-h-dvh flex-col xl:flex-row">
      <div className="relative h-[min(42vh,22rem)] w-full shrink-0 overflow-hidden bg-ink-900 sm:h-[min(46vh,26rem)] xl:h-auto xl:min-h-dvh xl:min-w-0 xl:flex-1">
        <img
          src={brandAssetUrl("/bg-login.png")}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[center_18%] xl:object-[35%_center]"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-black/10 xl:bg-gradient-to-r" />
      </div>

      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center bg-ink-50 px-4 py-8 dark:bg-ink-950 xl:w-[min(100%,36rem)] xl:flex-none xl:bg-transparent xl:px-10 xl:py-12 dark:xl:bg-transparent">
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
  );
}
