import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";

/**
 * Shell de autenticação 50/50.
 * Altura: preenche o #root (h-full), não 100dvh — em notebooks com
 * desktop-viewport-scale o layout é 100dvh/scale; h-dvh deixava faixa vazia.
 * Foto: background-size cover na coluna esquerda até o fim da tela.
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const bgUrl = brandAssetUrl("/bg-login.png");

  return (
    <div className="flex w-full min-h-dvh flex-1 flex-col md:grid md:h-full md:min-h-0 md:grid-cols-2 md:grid-rows-1 md:overflow-hidden">
      <aside
        className="relative hidden min-h-0 overflow-hidden bg-ink-900 md:block md:h-full md:min-h-full"
        aria-hidden
        style={{
          backgroundImage: `url("${bgUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "28% center",
          backgroundRepeat: "no-repeat",
        }}
      />

      <main className="relative flex min-h-dvh w-full flex-1 flex-col items-center justify-center overflow-y-auto bg-[#f6f4fb] px-4 py-10 dark:bg-ink-950 md:h-full md:min-h-0 md:flex-none md:px-8 lg:px-12">
        <div className="flex w-full max-w-md flex-col items-center">
          {children}
          <p className="mt-8 max-w-md text-center text-xs leading-relaxed text-ink-500 dark:text-ink-400">
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
      </main>
    </div>
  );
}
