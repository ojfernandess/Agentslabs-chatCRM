import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Linkedin, Mail, Youtube } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";
const LINKEDIN_URL = "https://www.linkedin.com/company/agentslabs";
const YOUTUBE_URL = "https://www.youtube.com/@agentslabs";
const PRIVACY_EMAIL = "mailto:privacidade@agentslabs.cloud";

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-sm text-slate-300 transition hover:text-white"
    >
      {children}
    </Link>
  );
}

export function LoginFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto w-full bg-[#071428] text-slate-300">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))] lg:gap-10">
          <div className="space-y-4 sm:col-span-2 lg:col-span-1">
            <img
              src={brandAssetUrl("/logo.svg")}
              alt="OpenNexo CRM"
              className="h-10 w-auto brightness-0 invert"
              decoding="async"
            />
            <p className="max-w-xs text-sm leading-relaxed text-slate-400">
              {t("loginFooter.tagline")}
            </p>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">{t("loginFooter.product")}</h3>
            <ul className="space-y-2">
              <li>
                <FooterLink to="/legal/about">{t("loginFooter.about")}</FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/features">{t("loginFooter.features")}</FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/help">{t("loginFooter.support")}</FooterLink>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">{t("loginFooter.legal")}</h3>
            <ul className="space-y-2">
              <li>
                <FooterLink to="/legal/terms">{t("loginFooter.terms")}</FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/privacy">{t("loginFooter.privacy")}</FooterLink>
              </li>
              <li>
                <FooterLink to="/legal/usage-rights">{t("loginFooter.usageRights")}</FooterLink>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">{t("loginFooter.help")}</h3>
            <ul className="space-y-2">
              <li>
                <span className="text-sm text-slate-400">{t("loginFooter.contactAdmin")}</span>
              </li>
              <li>
                <FooterLink to="/legal/help">{t("loginFooter.helpCenter")}</FooterLink>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">{t("loginFooter.followUs")}</h3>
            <div className="flex items-center gap-3">
              <a
                href={LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="LinkedIn"
              >
                <Linkedin className="h-5 w-5" />
              </a>
              <a
                href={YOUTUBE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="YouTube"
              >
                <Youtube className="h-5 w-5" />
              </a>
              <a
                href={PRIVACY_EMAIL}
                className="rounded p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label={t("loginFooter.email")}
              >
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6">
          <div className="flex flex-col gap-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {year} OpenNexo CRM. {t("loginFooter.rightsReserved")}{" "}
              <span className="text-slate-400">{VENDOR_NAME}</span>.
            </p>
            <p>
              {t("loginFooter.developedBy")}{" "}
              <a
                href={VENDOR_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-sky-400 hover:text-sky-300"
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
