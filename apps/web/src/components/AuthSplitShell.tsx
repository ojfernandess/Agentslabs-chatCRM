import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { LoginFooter } from "@/components/auth/LoginFooter";

/**
 * Shell de autenticação 50/50 com rodapé institucional em largura total.
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const bgUrl = brandAssetUrl("/bg-login.png");

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <div className="flex flex-1 flex-col md:grid md:min-h-0 md:grid-cols-2 md:grid-rows-1">
        <aside
          className="relative hidden min-h-0 overflow-hidden bg-ink-900 md:block md:h-full"
          aria-hidden
          style={{
            backgroundImage: `url("${bgUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "28% center",
            backgroundRepeat: "no-repeat",
          }}
        >
          {/* Escurece a imagem para o texto destacar */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#071428]/55 via-[#071428]/25 to-[#071428]/45" />

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#071428] via-[#071428]/85 to-transparent px-10 pb-12 pt-32">
            <div className="auth-hero-tagline-panel max-w-lg animate-fade-in">
              <p className="auth-hero-tagline-text">{t("loginFooter.heroTagline")}</p>
            </div>
          </div>
        </aside>

        <main className="relative flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center overflow-y-auto bg-[#f6f4fb] px-4 py-10 dark:bg-ink-950 md:min-h-0 md:px-8 lg:px-12">
          <div className="flex w-full max-w-md flex-col items-center">{children}</div>
        </main>
      </div>
      <LoginFooter />
    </div>
  );
}
