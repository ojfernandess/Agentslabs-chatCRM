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
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#071428]/90 via-[#071428]/40 to-transparent px-10 pb-12 pt-24">
            <HeroTagline />
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

function PremiumAuthShell({ children, bgUrl }: { children: ReactNode; bgUrl: string }) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <div className="relative flex flex-1 flex-col md:grid md:min-h-0 md:grid-cols-2 md:grid-rows-1">
        {/* Camadas premium — desktop (lg+) */}
        <div className="pointer-events-none absolute inset-0 z-0 hidden lg:block" aria-hidden>
          <div className="auth-login-stage-bg absolute inset-0" />
          <div className="auth-login-stage-glow absolute inset-0" />
          <div className="auth-login-diagonal-glow absolute inset-0" />
        </div>

        <aside
          className="auth-login-aside relative z-0 hidden min-h-0 overflow-hidden bg-ink-900 md:block md:h-full"
          aria-hidden
          style={heroImageStyle(bgUrl)}
        >
          <div className="auth-login-hero-overlay absolute inset-0 hidden lg:block" />

          {/* Tablet split clássico (md–lg) */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#071428]/90 via-[#071428]/40 to-transparent px-10 pb-12 pt-24 lg:hidden">
            <HeroTagline />
          </div>

          {/* Desktop integrado (lg+) */}
          <div className="auth-login-hero-bottom-fade absolute inset-x-0 bottom-0 hidden px-12 pb-14 pt-36 lg:block xl:px-14">
            <HeroTagline />
          </div>
        </aside>

        <main className="relative z-10 flex min-h-[60vh] w-full flex-1 flex-col overflow-y-auto bg-[#f6f4fb] dark:bg-ink-950 md:min-h-0 lg:col-span-2 lg:bg-transparent dark:lg:bg-transparent">
          <div className="flex w-full flex-1 flex-col items-center justify-center px-4 py-10 md:px-8 lg:ml-auto lg:w-[46%] lg:max-w-[720px] lg:px-10 lg:py-12 xl:px-14">
            <div className="flex w-full max-w-md flex-col items-center">{children}</div>
          </div>
        </main>
      </div>
      <LoginFooter />
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
