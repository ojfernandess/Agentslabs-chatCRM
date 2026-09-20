import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Instagram, Mail } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl, systemLogoDarkModeClass, systemLogoOnDarkBgClass } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";
const INSTAGRAM_URL = "https://www.instagram.com/agentslab.co";
const CONTACT_EMAIL = "mailto:contato@agentslabs.cloud";

type LoginFooterProps = {
  variant?: "brand" | "themed" | "adaptive";
  compact?: boolean;
};

function FooterLink({
  to,
  children,
  themed,
}: {
  to: string;
  children: ReactNode;
  themed: boolean;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "text-sm transition",
        themed
          ? "text-ink-600 hover:text-brand-600 dark:text-ink-300 dark:hover:text-brand-300"
          : "text-slate-300 hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}

export function LoginFooter({ variant = "brand", compact = false }: LoginFooterProps) {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  const themed = variant === "themed" || variant === "adaptive";
  const adaptive = variant === "adaptive";

  return (
    <footer
      className={clsx(
        "mt-auto w-full border-t",
        adaptive
          ? "border-ink-200/80 bg-[#f6f4fb] text-ink-600 dark:border-white/[0.06] dark:bg-[#0F1420] dark:text-ink-300"
          : themed
            ? "border-ink-200 bg-white text-ink-600 dark:border-ink-800 dark:bg-ink-950 dark:text-ink-300"
            : "border-transparent bg-[#071428] text-slate-300",
      )}
    >
      <div className={clsx("mx-auto max-w-7xl px-6 lg:px-12", compact ? "py-6 sm:py-7" : "py-10")}>
        <div
          className={clsx(
            "grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]",
            compact ? "lg:gap-8" : "lg:gap-10",
          )}
        >
          <div className="space-y-3 sm:col-span-2 lg:col-span-1">
            <img
              src={brandAssetUrl("/logo.svg")}
              alt="OpenNexo CRM"
              className={clsx(
                compact ? "h-8" : "h-10",
                "w-auto",
                themed ? systemLogoDarkModeClass : systemLogoOnDarkBgClass,
              )}
              decoding="async"
            />
            <p
              className={clsx(
                "max-w-xs leading-relaxed",
                compact ? "text-xs" : "text-sm",
                themed ? "text-ink-500 dark:text-ink-400" : "text-slate-400",
              )}
            >
              {t("loginFooter.tagline")}
            </p>
          </div>

          <div>
            <h3
              className={clsx(
                "mb-2.5 font-semibold",
                compact ? "text-xs" : "text-sm",
                themed ? "text-ink-900 dark:text-ink-50" : "text-white",
              )}
            >
              {t("loginFooter.product")}
            </h3>
            <ul className="space-y-1.5">
              <li>
                <FooterLink to="/legal/about" themed={themed}>
                  {t("loginFooter.about")}
                </FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/features" themed={themed}>
                  {t("loginFooter.features")}
                </FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/help" themed={themed}>
                  {t("loginFooter.support")}
                </FooterLink>
              </li>
            </ul>
          </div>

          <div>
            <h3
              className={clsx(
                "mb-2.5 font-semibold",
                compact ? "text-xs" : "text-sm",
                themed ? "text-ink-900 dark:text-ink-50" : "text-white",
              )}
            >
              {t("loginFooter.legal")}
            </h3>
            <ul className="space-y-1.5">
              <li>
                <FooterLink to="/legal/terms" themed={themed}>
                  {t("loginFooter.terms")}
                </FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/privacy" themed={themed}>
                  {t("loginFooter.privacy")}
                </FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/usage-rights" themed={themed}>
                  {t("loginFooter.usageRights")}
                </FooterLink>
              </li>
            </ul>
          </div>

          <div>
            <h3
              className={clsx(
                "mb-2.5 font-semibold",
                compact ? "text-xs" : "text-sm",
                themed ? "text-ink-900 dark:text-ink-50" : "text-white",
              )}
            >
              {t("loginFooter.help")}
            </h3>
            <ul className="space-y-1.5">
              <li>
                <span className={clsx(compact ? "text-xs" : "text-sm", themed ? "text-ink-500 dark:text-ink-400" : "text-slate-400")}>
                  {t("loginFooter.contactAdmin")}
                </span>
              </li>
              <li>
                <FooterLink to="/legal/help" themed={themed}>
                  {t("loginFooter.helpCenter")}
                </FooterLink>
              </li>
            </ul>
          </div>

          <div>
            <h3
              className={clsx(
                "mb-2.5 font-semibold",
                compact ? "text-xs" : "text-sm",
                themed ? "text-ink-900 dark:text-ink-50" : "text-white",
              )}
            >
              {t("loginFooter.followUs")}
            </h3>
            <div className="flex items-center gap-2.5">
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  "rounded p-1.5 transition",
                  themed
                    ? "text-ink-500 hover:bg-ink-100 hover:text-brand-600 dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-brand-300"
                    : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
                aria-label="Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a
                href={CONTACT_EMAIL}
                className={clsx(
                  "rounded p-1.5 transition",
                  themed
                    ? "text-ink-500 hover:bg-ink-100 hover:text-brand-600 dark:text-ink-400 dark:hover:bg-white/[0.06] dark:hover:text-brand-300"
                    : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
                aria-label={t("loginFooter.email")}
              >
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        <div
          className={clsx(
            "border-t pt-5",
            compact ? "mt-6" : "mt-10",
            adaptive
              ? "border-ink-200/80 dark:border-white/[0.06]"
              : themed
                ? "border-ink-200 dark:border-ink-800"
                : "border-white/10",
          )}
        >
          <div
            className={clsx(
              "flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between",
              compact ? "text-[11px]" : "text-xs",
              themed ? "text-ink-500 dark:text-ink-400" : "text-slate-500",
            )}
          >
            <p>
              © {year} OpenNexo CRM. {t("loginFooter.rightsReserved")}{" "}
              <span className={themed ? "text-ink-600 dark:text-ink-300" : "text-slate-400"}>{VENDOR_NAME}</span>.
            </p>
            <p>
              {t("loginFooter.developedBy")}{" "}
              <a
                href={VENDOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  "font-semibold",
                  themed ? "text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300" : "text-sky-400 hover:text-sky-300",
                )}
              >
                {VENDOR_NAME}
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
