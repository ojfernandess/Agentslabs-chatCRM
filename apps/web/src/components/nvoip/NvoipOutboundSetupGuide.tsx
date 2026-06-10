import { ExternalLink, Info } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useNvoipVoiceOptional } from "@/contexts/NvoipVoiceContext";
import { isLikelyNvoipNumbersipCaller } from "@/lib/mapNvoipCallError";

const NVOIP_PANEL_URL = "https://painel.nvoip.com.br";

type Props = {
  linked: boolean;
  defaultCaller: string;
  accountNumbersip?: string;
};

export function NvoipOutboundSetupGuide({ linked, defaultCaller, accountNumbersip }: Props) {
  const { t } = useI18n();
  const voice = useNvoipVoiceOptional();
  const caller = voice?.caller?.trim() || defaultCaller.trim() || null;
  const invalidCaller = caller ? isLikelyNvoipNumbersipCaller(caller, accountNumbersip) : false;
  const pabxWarning =
    voice?.callerWarning === "pabx_trunk_not_webphone" ||
    (caller &&
      accountNumbersip &&
      caller.replace(/\D/g, "") === accountNumbersip.replace(/\D/g, "") &&
      !voice?.callerHasWebphone);
  const noWebphone =
    voice?.ready &&
    linked &&
    (voice.callerWarning === "no_webphone_users" || voice.webphoneUsers.length === 0);

  const steps = [
    t("nvoip.setup.step1"),
    t("nvoip.setup.step2"),
    t("nvoip.setup.step3"),
    t("nvoip.setup.step4"),
  ];

  return (
    <div className="mt-6 max-w-2xl rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-ink-100">{t("nvoip.setup.title")}</h3>
          <p className="mt-1 text-xs text-slate-600 dark:text-ink-400">{t("nvoip.setup.subtitle")}</p>
          {caller ? (
            <p className="mt-2 text-xs font-medium text-sky-800 dark:text-sky-200">
              {t("nvoip.setup.currentCaller")}: <span className="font-mono">{caller}</span>
            </p>
          ) : linked ? (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{t("nvoip.voice.noCaller")}</p>
          ) : null}
          {invalidCaller ? (
            <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
              {t("nvoip.setup.invalidCallerWarning")}
            </p>
          ) : null}
          {pabxWarning && linked ? (
            <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
              {t("nvoip.setup.pabxTrunkWarning")}
            </p>
          ) : null}
          {noWebphone && linked ? (
            <p className="mt-2 text-xs font-medium text-red-800 dark:text-red-300">
              {t("nvoip.setup.noWebphoneWarning")}
            </p>
          ) : null}
          {voice?.webphoneUsers && voice.webphoneUsers.length > 0 ? (
            <p className="mt-2 text-xs text-sky-700 dark:text-sky-300">
              {t("nvoip.setup.webphoneAvailable")}:{" "}
              {voice.webphoneUsers
                .map((u) => u.caller?.trim() || u.numbersip)
                .slice(0, 4)
                .join(", ")}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-slate-600 dark:text-ink-400">{t("nvoip.setup.noDirectBrowser")}</p>
          <ol className="mt-3 list-decimal space-y-2 pl-4 text-xs text-slate-700 dark:text-ink-300">
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <a
            href={NVOIP_PANEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t("nvoip.panelLink")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
