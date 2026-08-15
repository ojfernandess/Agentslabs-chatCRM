import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";

/**
 * Shell de autenticação no padrão 50/50 (referência: foto full-bleed + formulário centrado).
 * md+: grid 2 colunas, altura = viewport — foto cobre 100% da metade esquerda.
 * Abaixo de md: só o painel do formulário (padrão auth moderno deste tipo).
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="min-h-dvh md:grid md:h-dvh md:grid-cols-2 md:overflow-hidden">
      <aside className="relative hidden overflow-hidden bg-ink-900 md:block" aria-hidden>
        <img
          src={brandAssetUrl("/bg-login.png")}
          alt=""
          className="absolute inset-0 size-full object-cover object-[28%_center]"
          decoding="async"
        />
      </aside>

      <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-y-auto bg-[#f6f4fb] px-4 py-10 dark:bg-ink-950 md:h-full md:min-h-0 md:px-8 lg:px-12">
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
