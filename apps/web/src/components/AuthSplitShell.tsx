import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, MessageCircle, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";
import { LoginFooter } from "@/components/auth/LoginFooter";
import { motion } from "@/components/Motion";
import clsx from "clsx";

const HERO_BENEFITS = [
  {
    titleKey: "loginFooter.heroHighlight1Title",
    descKey: "loginFooter.heroHighlight1Desc",
    icon: MessageCircle,
  },
  {
    titleKey: "loginFooter.heroHighlight2Title",
    descKey: "loginFooter.heroHighlight2Desc",
    icon: Sparkles,
  },
  {
    titleKey: "loginFooter.heroHighlight3Title",
    descKey: "loginFooter.heroHighlight3Desc",
    icon: BarChart3,
  },
] as const;

function LoginHeroPanel() {
  const { t } = useI18n();
  const [activeHighlight, setActiveHighlight] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveHighlight((index) => (index + 1) % HERO_BENEFITS.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#071428]/55 via-[#071428]/15 to-transparent px-10 pb-12 pt-28">
      <div
        className="relative max-w-[420px] overflow-hidden rounded-[24px] border border-white/[0.12] px-8 py-8"
        style={{
          background: "rgba(17, 24, 39, 0.72)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.22)",
        }}
      >
        <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-white">
          {t("loginFooter.heroTaglineLead")}
          <span className="text-brand-400">{t("loginFooter.heroTaglineAccent")}</span>
        </h2>

        <p className="mt-3 max-w-[340px] text-[15px] leading-relaxed text-white/70">
          {t("loginFooter.heroDescription")}
        </p>

        <ul className="mt-6 space-y-5" aria-live="polite">
          {HERO_BENEFITS.map((benefit, index) => {
            const isActive = index === activeHighlight;
            const Icon = benefit.icon;
            return (
              <motion.li
                key={benefit.titleKey}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * index, duration: 0.35, ease: "easeOut" }}
                className="flex gap-3.5"
              >
                <motion.span
                  animate={{
                    backgroundColor: isActive ? "rgba(103, 52, 255, 0.35)" : "rgba(103, 52, 255, 0.18)",
                    boxShadow: isActive ? "0 0 0 1px rgba(143, 116, 255, 0.35)" : "0 0 0 1px rgba(143, 116, 255, 0.1)",
                  }}
                  transition={{ duration: 0.4, ease: "easeInOut" }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                >
                  <Icon className="h-5 w-5 text-white" strokeWidth={1.75} aria-hidden />
                </motion.span>
                <div className="min-w-0 pt-0.5">
                  <motion.p
                    animate={{ color: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.92)" }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                    className="text-sm font-semibold leading-snug"
                  >
                    {t(benefit.titleKey)}
                  </motion.p>
                  <motion.p
                    animate={{ color: isActive ? "rgba(255, 255, 255, 0.72)" : "rgba(255, 255, 255, 0.55)" }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                    className="mt-0.5 text-sm leading-snug"
                  >
                    {t(benefit.descKey)}
                  </motion.p>
                </div>
              </motion.li>
            );
          })}
        </ul>

        <div className="mt-8 flex items-center gap-2 border-t border-white/10 pt-5">
          {HERO_BENEFITS.map((benefit, index) => (
            <button
              key={benefit.titleKey}
              type="button"
              aria-label={`${t(benefit.titleKey)}`}
              onClick={() => setActiveHighlight(index)}
              className={clsx(
                "h-2 rounded-full transition-all duration-300",
                index === activeHighlight ? "w-6 bg-brand-400" : "w-2 bg-white/25 hover:bg-white/40",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Shell de autenticação 50/50 com rodapé institucional em largura total.
 */
export function AuthSplitShell({ children }: { children: ReactNode }) {
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
          <LoginHeroPanel />
        </aside>

        <main className="relative flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center overflow-y-auto bg-[#f6f4fb] px-4 py-10 dark:bg-ink-950 md:min-h-0 md:px-8 lg:px-12">
          <div className="flex w-full max-w-md flex-col items-center">{children}</div>
        </main>
      </div>
      <LoginFooter />
    </div>
  );
}
