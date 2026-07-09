import { useMemo, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { isValidEmailAddress, parseEmailAddressList } from "@openconduit/shared";
import { useI18n } from "@/i18n/I18nProvider";

function uniqueEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of list) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function EmailChipInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const commitDraft = (raw: string) => {
    const parsed = parseEmailAddressList(raw);
    if (parsed.length === 0) {
      if (raw.trim()) setInvalid(true);
      return false;
    }
    onChange(uniqueEmails([...value, ...parsed]));
    setDraft("");
    setInvalid(false);
    return true;
  };

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-ink-300">{label}</span>
      <div
        className={clsx(
          "flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 dark:bg-ink-950",
          invalid
            ? "border-rose-400 focus-within:ring-1 focus-within:ring-rose-400/40"
            : "border-ink-200 focus-within:border-brand-400 focus-within:ring-1 focus-within:ring-brand-500/20 dark:border-ink-700",
          disabled && "opacity-60",
        )}
      >
        {value.map((email) => (
          <span
            key={email}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <span className="truncate">{email}</span>
            {!disabled ? (
              <button
                type="button"
                className="rounded p-0.5 text-amber-800/70 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
                onClick={() => onChange(value.filter((e) => e !== email))}
                aria-label={`Remove ${email}`}
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
              if (!draft.trim()) return;
              e.preventDefault();
              commitDraft(draft);
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) commitDraft(draft);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!text || !/[,;\s]/.test(text)) return;
            e.preventDefault();
            commitDraft(`${draft} ${text}`);
          }}
          className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-ink-900 outline-none placeholder:text-ink-400 dark:text-ink-50 dark:placeholder:text-ink-500"
          placeholder={value.length === 0 ? placeholder : undefined}
          autoComplete="email"
          inputMode="email"
        />
      </div>
    </label>
  );
}

export type EmailRecipientFieldsValue = {
  to: string[];
  cc: string[];
  bcc: string[];
};

export function EmailRecipientFields({
  value,
  onChange,
  disabled,
  showCcBccToggle = true,
  toRequired = true,
  className,
  density = "default",
}: {
  value: EmailRecipientFieldsValue;
  onChange: (next: EmailRecipientFieldsValue) => void;
  disabled?: boolean;
  showCcBccToggle?: boolean;
  toRequired?: boolean;
  className?: string;
  density?: "default" | "compact";
}) {
  const { t } = useI18n();
  const [showCc, setShowCc] = useState(value.cc.length > 0);
  const [showBcc, setShowBcc] = useState(value.bcc.length > 0);

  const labelClass = density === "compact" ? "text-[11px]" : "text-xs";

  const hint = useMemo(
    () => t("inboxesPage.emailWorkspace.composeRecipientsHint"),
    [t],
  );

  return (
    <div className={clsx("space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={clsx("text-ink-500 dark:text-ink-400", labelClass)}>{hint}</p>
        {showCcBccToggle ? (
          <div className="flex items-center gap-2">
            {!showCc ? (
              <button
                type="button"
                className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                onClick={() => setShowCc(true)}
                disabled={disabled}
              >
                {t("inboxesPage.emailWorkspace.composeAddCc")}
              </button>
            ) : null}
            {!showBcc ? (
              <button
                type="button"
                className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                onClick={() => setShowBcc(true)}
                disabled={disabled}
              >
                {t("inboxesPage.emailWorkspace.composeAddBcc")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <EmailChipInput
        label={
          toRequired
            ? t("inboxesPage.emailWorkspace.composeToEmail")
            : t("inboxesPage.emailWorkspace.composeToEmailOptional")
        }
        value={value.to}
        onChange={(to) => onChange({ ...value, to })}
        placeholder={t("inboxesPage.emailWorkspace.composeToEmailPlaceholder")}
        disabled={disabled}
      />

      {showCc || value.cc.length > 0 ? (
        <EmailChipInput
          label={t("inboxesPage.emailWorkspace.composeCc")}
          value={value.cc}
          onChange={(cc) => onChange({ ...value, cc })}
          placeholder={t("inboxesPage.emailWorkspace.composeCcPlaceholder")}
          disabled={disabled}
        />
      ) : null}

      {showBcc || value.bcc.length > 0 ? (
        <EmailChipInput
          label={t("inboxesPage.emailWorkspace.composeBcc")}
          value={value.bcc}
          onChange={(bcc) => onChange({ ...value, bcc })}
          placeholder={t("inboxesPage.emailWorkspace.composeBccPlaceholder")}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

export function emailRecipientsPayload(value: EmailRecipientFieldsValue): {
  emailTo?: string;
  emailCc?: string;
  emailBcc?: string;
} {
  const to = uniqueEmails(value.to);
  const cc = uniqueEmails(value.cc);
  const bcc = uniqueEmails(value.bcc);
  return {
    ...(to.length > 0 ? { emailTo: to.join(", ") } : {}),
    ...(cc.length > 0 ? { emailCc: cc.join(", ") } : {}),
    ...(bcc.length > 0 ? { emailBcc: bcc.join(", ") } : {}),
  };
}

export function hasValidEmailTo(value: EmailRecipientFieldsValue, allowEmpty = false): boolean {
  if (value.to.length === 0) return allowEmpty;
  return value.to.every((email) => isValidEmailAddress(email));
}
