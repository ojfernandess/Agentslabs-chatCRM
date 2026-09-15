import clsx from "clsx";
import { AlertTriangle, Info, Lightbulb, Lock, Sparkles } from "lucide-react";
import type { HelpCalloutVariant } from "@/lib/help/types";

const VARIANTS: Record<
  HelpCalloutVariant,
  { icon: typeof Info; label: string; className: string }
> = {
  tip: {
    icon: Lightbulb,
    label: "Dica",
    className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100",
  },
  important: {
    icon: AlertTriangle,
    label: "Importante",
    className: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100",
  },
  admin: {
    icon: Lock,
    label: "Administrador",
    className: "border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-100",
  },
  example: {
    icon: Sparkles,
    label: "Exemplo",
    className: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100",
  },
  info: {
    icon: Info,
    label: "Informação",
    className: "border-ink-200 bg-ink-50 text-ink-800 dark:border-ink-700 dark:bg-ink-800/50 dark:text-ink-100",
  },
};

type Props = {
  variant: HelpCalloutVariant;
  title?: string;
  text: string;
};

export function HelpCallout({ variant, title, text }: Props) {
  const cfg = VARIANTS[variant];
  const Icon = cfg.icon;
  return (
    <aside
      className={clsx(
        "my-4 flex gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed",
        cfg.className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <div>
        <p className="font-semibold">{title ?? cfg.label}</p>
        <p className="mt-1 whitespace-pre-line opacity-90">{text}</p>
      </div>
    </aside>
  );
}
