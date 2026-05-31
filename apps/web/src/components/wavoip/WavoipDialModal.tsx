import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, backdropVariants, modalVariants } from "@/components/Motion";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { useWavoipVoiceOptional } from "@/contexts/WavoipVoiceContext";
import {
  X,
  Phone,
  Delete,
  Loader2,
  UserPlus,
  Users,
  Search,
} from "lucide-react";
import clsx from "clsx";

type ContactRow = { id: string; name: string; phone: string; email: string | null };

type Tab = "dial" | "contacts";

type ResolveContext = {
  dialPhone: string;
  contact: { id: string; name: string; phone: string } | null;
  conversationId: string | null;
};

const DIAL_KEYS: { digit: string; sub?: string }[] = [
  { digit: "1" },
  { digit: "2", sub: "ABC" },
  { digit: "3", sub: "DEF" },
  { digit: "4", sub: "GHI" },
  { digit: "5", sub: "JKL" },
  { digit: "6", sub: "MNO" },
  { digit: "7", sub: "PQRS" },
  { digit: "8", sub: "TUV" },
  { digit: "9", sub: "WXYZ" },
  { digit: "*" },
  { digit: "0", sub: "+" },
  { digit: "#" },
];

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function sanitizeDialInput(raw: string): string {
  return raw.replace(/[^\d+*#]/g, "");
}

function isValidDialLength(phone: string): boolean {
  const d = digitsOnly(phone);
  return d.length >= 10 && d.length <= 15;
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function WavoipDialModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const voice = useWavoipVoiceOptional();
  const wavoipEnabled = user?.organizationFeatures?.wavoip_voice !== false;
  const canCall = wavoipEnabled && voice?.ready && (voice?.devices.length ?? 0) > 0;

  const [tab, setTab] = useState<Tab>("dial");
  const [digits, setDigits] = useState("");
  const [contactQ, setContactQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [resolvedContext, setResolvedContext] = useState<ResolveContext | null>(null);
  const [resolvingPhone, setResolvingPhone] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [newName, setNewName] = useState("");
  const [registerBusy, setRegisterBusy] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(contactQ.trim()), 300);
    return () => window.clearTimeout(id);
  }, [contactQ]);

  useEffect(() => {
    const raw = digits.trim();
    if (!isValidDialLength(raw)) {
      setResolvedContext(null);
      return;
    }
    const id = window.setTimeout(() => {
      void (async () => {
        setResolvingPhone(true);
        try {
          const ctx = await api.get<ResolveContext>(
            `/wavoip/calls/resolve-context?phone=${encodeURIComponent(raw)}`,
          );
          setResolvedContext(ctx);
        } catch {
          setResolvedContext(null);
        } finally {
          setResolvingPhone(false);
        }
      })();
    }, 350);
    return () => window.clearTimeout(id);
  }, [digits]);

  const fetchContacts = useCallback(async (term: string) => {
    setLoadingContacts(true);
    try {
      const params = new URLSearchParams({ pageSize: "25" });
      if (term) params.set("search", term);
      const res = await api.get<{ data: ContactRow[] }>(`/contacts?${params}`);
      setContacts(res.data ?? []);
    } catch {
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "contacts") return;
    void fetchContacts(debouncedQ);
  }, [open, tab, debouncedQ, fetchContacts]);

  useEffect(() => {
    if (!open) {
      setTab("dial");
      setDigits("");
      setContactQ("");
      setDebouncedQ("");
      setContacts([]);
      setResolvedContext(null);
      setError("");
      setShowRegister(false);
      setNewName("");
    }
  }, [open]);

  const matchedContact = resolvedContext?.contact ?? null;

  const isNewNumber = isValidDialLength(digits) && !matchedContact;

  const setDialValue = (value: string) => {
    setError("");
    setShowRegister(false);
    setDigits(sanitizeDialInput(value));
  };

  const appendDigit = (d: string) => {
    setDialValue(`${digits}${d}`);
  };

  const backspace = () => {
    setError("");
    setShowRegister(false);
    setDigits((prev) => prev.slice(0, -1));
  };

  const placeCall = async (input: {
    phone: string;
    contactId?: string | null;
  }) => {
    if (!voice || !canCall) {
      setError(t("wavoip.voice.noDevices"));
      return;
    }
    const phone = input.phone.trim();
    if (!isValidDialLength(phone)) {
      setError(t("wavoip.dial.invalidPhone"));
      return;
    }
    setCalling(true);
    setError("");
    try {
      const res = await voice.startOutboundCall({
        phone,
        contactId: input.contactId ?? matchedContact?.id ?? null,
      });
      if (!res.ok) {
        setError(res.message === "no_devices" ? t("wavoip.voice.noDevices") : res.message);
        return;
      }
      onClose();
    } finally {
      setCalling(false);
    }
  };

  const registerAndCall = async () => {
    const name = newName.trim();
    const phone = digits.trim();
    if (!name || !isValidDialLength(phone)) {
      setError(t("wavoip.dial.registerFillRequired"));
      return;
    }
    setRegisterBusy(true);
    setError("");
    try {
      const created = await api.post<{ id: string; name: string; phone: string }>("/contacts", {
        name,
        phone,
      });
      await placeCall({ phone: created.phone, contactId: created.id });
    } catch (e: unknown) {
      const st = e instanceof ApiError ? e.status : 0;
      if (st === 409) {
        try {
          const ctx = await api.get<ResolveContext>(
            `/wavoip/calls/resolve-context?phone=${encodeURIComponent(phone)}`,
          );
          if (ctx.contact) {
            await placeCall({ phone: ctx.dialPhone || phone, contactId: ctx.contact.id });
            return;
          }
        } catch {
          /* fall through */
        }
        setError(t("wavoip.dial.duplicatePhone"));
      } else {
        setError(t("wavoip.dial.registerFailed"));
      }
    } finally {
      setRegisterBusy(false);
    }
  };

  const dialPhoneForCall = useMemo(
    () => resolvedContext?.dialPhone || digits.trim(),
    [resolvedContext, digits],
  );

  if (!canCall) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 dark:bg-black/60"
          variants={backdropVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-sm overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900"
            variants={modalVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-ink-800">
              <div className="flex gap-1 rounded-full bg-gray-100 p-0.5 dark:bg-ink-800">
                <button
                  type="button"
                  onClick={() => setTab("dial")}
                  className={clsx(
                    "rounded-full px-3 py-1 text-xs font-semibold transition",
                    tab === "dial"
                      ? "bg-white text-gray-900 shadow-sm dark:bg-ink-900 dark:text-ink-50"
                      : "text-gray-500 dark:text-ink-400",
                  )}
                >
                  {t("wavoip.dial.tabDial")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("contacts")}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition",
                    tab === "contacts"
                      ? "bg-white text-gray-900 shadow-sm dark:bg-ink-900 dark:text-ink-50"
                      : "text-gray-500 dark:text-ink-400",
                  )}
                >
                  <Users className="h-3.5 w-3.5" />
                  {t("wavoip.dial.tabContacts")}
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-ink-800 dark:hover:text-ink-200"
                aria-label={t("common.close")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {tab === "dial" ? (
              <div className="p-5">
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={digits}
                  onChange={(e) => setDialValue(e.target.value)}
                  onPaste={(e) => {
                    e.preventDefault();
                    setDialValue(e.clipboardData.getData("text"));
                  }}
                  placeholder={t("wavoip.dial.typePlaceholder")}
                  aria-label={t("wavoip.dial.typePlaceholder")}
                  className={clsx(
                    "w-full border-0 bg-transparent text-center text-xl font-medium tracking-wide tabular-nums outline-none ring-0",
                    "placeholder:text-gray-400 dark:placeholder:text-ink-500",
                    digits ? "text-gray-900 dark:text-ink-50" : "text-gray-400 dark:text-ink-500",
                  )}
                  autoFocus
                />
                <p className="mt-1 text-center text-[10px] text-gray-400 dark:text-ink-500">
                  {t("wavoip.dial.pasteHint")}
                </p>

                {resolvingPhone ? (
                  <div className="mt-2 flex justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
                  </div>
                ) : matchedContact ? (
                  <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-center dark:border-emerald-900/40 dark:bg-emerald-950/30">
                    <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                      {matchedContact.name}
                    </p>
                    <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">{matchedContact.phone}</p>
                  </div>
                ) : isNewNumber ? (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-center dark:border-amber-900/40 dark:bg-amber-950/25">
                    <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{t("wavoip.dial.newNumber")}</p>
                    {!showRegister ? (
                      <button
                        type="button"
                        onClick={() => setShowRegister(true)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {t("wavoip.dial.registerContact")}
                      </button>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <input
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder={t("contactEdit.fieldName")}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                        />
                        <button
                          type="button"
                          disabled={registerBusy || calling}
                          onClick={() => void registerAndCall()}
                          className="w-full rounded-lg bg-brand-500 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                        >
                          {registerBusy ? t("wavoip.dial.registering") : t("wavoip.dial.registerAndCall")}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mt-4 grid grid-cols-3 gap-3">
                  {DIAL_KEYS.map(({ digit, sub }) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => appendDigit(digit)}
                      className="flex h-14 flex-col items-center justify-center rounded-full bg-gray-100 text-gray-900 transition hover:bg-gray-200 active:scale-95 dark:bg-ink-800 dark:text-ink-50 dark:hover:bg-ink-700"
                    >
                      <span className="text-xl font-medium leading-none">{digit}</span>
                      {sub ? (
                        <span className="mt-0.5 text-[9px] font-semibold tracking-widest text-gray-400 dark:text-ink-500">
                          {sub}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-center gap-6">
                  <div className="w-10" />
                  <button
                    type="button"
                    disabled={calling || !!voice?.activeCall || !isValidDialLength(digits)}
                    onClick={() =>
                      void placeCall({
                        phone: dialPhoneForCall,
                        contactId: matchedContact?.id,
                      })
                    }
                    className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition hover:bg-emerald-600 active:scale-95 disabled:opacity-40"
                    aria-label={t("wavoip.voice.callButton")}
                  >
                    {calling ? <Loader2 className="h-7 w-7 animate-spin" /> : <Phone className="h-7 w-7" />}
                  </button>
                  <button
                    type="button"
                    onClick={backspace}
                    disabled={!digits.length}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-ink-400 dark:hover:bg-ink-800"
                    aria-label={t("wavoip.dial.backspace")}
                  >
                    <Delete className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={contactQ}
                    onChange={(e) => setContactQ(e.target.value)}
                    placeholder={t("wavoip.dial.searchContacts")}
                    className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-3 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100"
                    autoFocus
                  />
                </div>
                <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-gray-100 dark:border-ink-800">
                  {loadingContacts ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
                    </div>
                  ) : contacts.length === 0 ? (
                    <p className="px-3 py-8 text-center text-xs text-gray-500 dark:text-ink-400">
                      {t("wavoip.dial.noContacts")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-ink-800">
                      {contacts.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            disabled={calling || !!voice?.activeCall}
                            onClick={() => void placeCall({ phone: c.phone, contactId: c.id })}
                            className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-ink-800/80"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <Phone className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-gray-900 dark:text-ink-50">
                                {c.name}
                              </span>
                              <span className="block truncate text-xs text-gray-500 dark:text-ink-400">{c.phone}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {error ? (
              <p className="border-t border-gray-100 px-4 py-2 text-center text-xs text-red-600 dark:border-ink-800 dark:text-red-400">
                {error}
              </p>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
