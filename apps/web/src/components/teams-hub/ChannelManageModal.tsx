import { useEffect, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Hash, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export type ChannelKind = "GENERAL" | "ANNOUNCEMENTS" | "OPS";

export interface ChannelFormState {
  name: string;
  description: string;
  kind: ChannelKind;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initial?: ChannelFormState;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (data: ChannelFormState) => void | Promise<void>;
}

const KINDS: ChannelKind[] = ["GENERAL", "ANNOUNCEMENTS", "OPS"];

export function ChannelManageModal({ open, mode, initial, busy, onClose, onSubmit }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ChannelKind>("GENERAL");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setKind(initial?.kind ?? "GENERAL");
  }, [open, initial?.name, initial?.description, initial?.kind]);

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void onSubmit({ name: trimmed, description: description.trim(), kind });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} aria-label={t("common.cancel")} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-md rounded-2xl border border-ink-200 bg-white p-5 shadow-2xl dark:border-ink-700 dark:bg-ink-950"
      >
        <ModalHeader onClose={onClose} title={mode === "create" ? t("teamsHub.channelCreate") : t("teamsHub.channelEdit")} />

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-600 dark:text-ink-400">{t("teamsHub.channelName")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("teamsHub.channelNamePlaceholder")}
              className="input-field w-full"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-600 dark:text-ink-400">{t("teamsHub.channelDescription")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="input-field w-full resize-y"
              placeholder={t("teamsHub.channelDescriptionPlaceholder")}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-600 dark:text-ink-400">{t("teamsHub.channelKind")}</label>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={clsx(
                    "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                    kind === k
                      ? "bg-violet-500 text-white"
                      : "border border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-300",
                  )}
                >
                  {t(`teamsHub.channelKinds.${k}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary text-sm disabled:opacity-50">
            {busy ? t("teams.saving") : mode === "create" ? t("teamsHub.channelCreate") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold text-ink-900 dark:text-ink-50">
        <Hash className="h-4 w-4 text-violet-500" />
        {title}
      </h2>
      <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
