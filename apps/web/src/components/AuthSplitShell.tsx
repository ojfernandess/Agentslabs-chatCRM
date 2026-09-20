import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { LoginFooter } from "@/components/auth/LoginFooter";

type AuthSplitShellProps = {
  children: ReactNode;
  /** `premium` — layout integrado com transição diagonal (login). `classic` — split 50/50 (outras páginas auth). */
  variant?: "classic" | "premium";
};

const heroImageStyle = (bgUrl: string): CSSProperties => ({
  backgroundImage: `url("${bgUrl}")`,
  backgroundSize: "cover",
  backgroundPosition: "28% center",
  backgroundRepeat: "no-repeat",
});

function HeroTagline() {
  const { t } = useI18n();
  return <p className="auth-hero-tagline-text">{t("loginFooter.heroTagline")}</p>;
}

function ClassicAuthShell({ children, bgUrl }: { children: ReactNode; bgUrl: string }) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <div className="flex flex-1 flex-col md:grid md:min-h-0 md:grid-cols-2 md:grid-rows-1">
        <aside
          className="relative hidden min-h-0 overflow-hidden bg-ink-900 md:block md:h-full"
          aria-hidden
          style={heroImageStyle(bgUrl)}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#071428]/50 via-[#071428]/20 to-[#071428]/40" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#071428]/95 via-[#071428]/70 to-transparent px-10 pb-12 pt-28">
            <HeroTagline />
          </div>
        </aside>

        <main className="relative flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center overflow-y-auto bg-[#f6f4fb] px-4 py-10 dark:bg-ink-950 md:min-h-0 md:px-8 lg:px-12">
          <div className="flex w-full max-w-md flex-col items-center">{children}</div>
        </main>
      </div>
      <LoginFooter variant="adaptive" />
    </div>
  );
}

function PremiumAuthShell({ children, bgUrl }: { children: ReactNode; bgUrl: string }) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <div className="auth-login-stage relative flex min-h-0 flex-1 flex-col lg:min-h-[calc(100dvh-12rem)]">
        <div className="auth-login-stage-bg absolute inset-0" aria-hidden />
        <div className="auth-login-stage-glow pointer-events-none absolute inset-0" aria-hidden />

        {/* Mobile / tablet: faixa de imagem no topo */}
        <div
          className="auth-login-hero-mobile relative h-40 shrink-0 overflow-hidden sm:h-48 lg:hidden"
          aria-hidden
          style={heroImageStyle(bgUrl)}
        >
          <div className="auth-login-hero-overlay absolute inset-0" />
          <div className="auth-login-hero-bottom-fade absolute inset-x-0 bottom-0 px-6 pb-6 pt-16 sm:px-8">
            <HeroTagline />
          </div>
        </div>

        {/* Desktop: imagem com recorte diagonal (~58% da largura) */}
        <div
          className="auth-login-hero pointer-events-none absolute inset-y-0 left-0 hidden lg:block"
          aria-hidden
          style={heroImageStyle(bgUrl)}
        >
          <div className="auth-login-hero-overlay absolute inset-0" />
          <div className="auth-login-hero-bottom-fade absolute inset-x-0 bottom-0 px-12 pb-14 pt-36 xl:px-14">
            <HeroTagline />
          </div>
        </div>

        {/* Coluna do formulário + card */}
        <div className="auth-login-form-column relative flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-6 lg:ml-auto lg:w-[46%] lg:max-w-[720px] lg:shrink-0 lg:px-10 lg:py-12 xl:px-14">
          {children}
        </div>
      </div>
      <LoginFooter variant="adaptive" compact />
    </div>
  );
}

/**
 * Shell de autenticação com rodapé institucional em largura total.
 */
export function AuthSplitShell({ children, variant = "classic" }: AuthSplitShellProps) {
  const bgUrl = brandAssetUrl("/bg-login.png");

  if (variant === "premium") {
    return <PremiumAuthShell bgUrl={bgUrl}>{children}</PremiumAuthShell>;
  }

  return <ClassicAuthShell bgUrl={bgUrl}>{children}</ClassicAuthShell>;
}
