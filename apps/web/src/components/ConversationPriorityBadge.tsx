import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import {
  priorityBadgeClass,
  priorityIcon,
  priorityLabelKey,
  type ConversationPriority,
  type ConversationPriorityValue,
  isConversationPriority,
} from "@/lib/conversationPriority";

type Props = {
  priority: ConversationPriorityValue;
  /** compact = só ícone (lista no avatar) */
  variant?: "badge" | "compact" | "iconOnly";
  className?: string;
  title?: string;
};

export function ConversationPriorityBadge({ priority, variant = "badge", className, title }: Props) {
  const { t } = useI18n();
  if (!isConversationPriority(priority)) return null;

  const Icon = priorityIcon(priority);
  const label = t(priorityLabelKey(priority));
  const tip = title ?? label;

  if (variant === "iconOnly" || variant === "compact") {
    return (
      <span
        className={clsx(
          "inline-flex items-center justify-center rounded-full",
          variant === "compact" ? "h-[18px] w-[18px]" : "h-5 w-5",
          priorityBadgeClass(priority),
          className,
        )}
        title={tip}
        aria-label={label}
      >
        <Icon className={variant === "compact" ? "h-2.5 w-2.5" : "h-3 w-3"} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        priorityBadgeClass(priority),
        className,
      )}
      title={tip}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
      {label}
    </span>
  );
}

type PickerProps = {
  value: ConversationPriorityValue;
  disabled?: boolean;
  onChange: (priority: ConversationPriority | null) => void;
};

export function ConversationPriorityPicker({ value, disabled, onChange }: PickerProps) {
  const { t } = useI18n();
  const options: { id: ConversationPriority | "NONE"; p: ConversationPriority | null }[] = [
    { id: "NONE", p: null },
    { id: "URGENT", p: "URGENT" },
    { id: "HIGH", p: "HIGH" },
    { id: "MEDIUM", p: "MEDIUM" },
    { id: "LOW", p: "LOW" },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = (value ?? null) === opt.p;
        const label = t(priorityLabelKey(opt.id));
        const Icon = opt.p ? priorityIcon(opt.p) : null;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.p)}
            className={clsx(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition",
              active
                ? opt.p
                  ? clsx(priorityBadgeClass(opt.p), "border-transparent")
                  : "border-ink-300 bg-ink-100 text-ink-800 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900/40 dark:text-ink-300 dark:hover:bg-ink-800",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2.5} /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}
