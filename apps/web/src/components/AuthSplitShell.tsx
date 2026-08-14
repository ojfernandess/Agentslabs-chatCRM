import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { brandAssetUrl } from "@/lib/brandingAssets";

const VENDOR_URL = "https://www.agentslabs.cloud/";
const VENDOR_NAME = "AgentsLabs";

export function AuthSplitShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <div className="relative flex min-h-dvh flex-col lg:flex-row">
      <div className="relative min-h-[220px] min-w-0 flex-1 overflow-hidden bg-ink-800 lg:min-h-dvh">
        <img
          src={brandAssetUrl("/bg-login.png")}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-black/10 lg:bg-gradient-to-r" />
      </div>

      <div className="relative z-10 flex w-full max-w-xl flex-1 flex-col items-center justify-center bg-ink-50 px-4 py-10 dark:bg-ink-950 lg:max-w-none lg:bg-transparent lg:px-10 lg:py-12 dark:lg:bg-transparent">
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
