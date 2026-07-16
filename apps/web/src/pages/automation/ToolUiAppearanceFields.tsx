import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Search } from "lucide-react";

export const TOOL_UI_COLOR_PRESETS = [
  { id: "cyan", accent: "from-cyan-500/30 to-blue-600/10" },
  { id: "rose", accent: "from-rose-500/30 to-orange-600/10" },
  { id: "violet", accent: "from-violet-500/25 to-fuchsia-600/10" },
  { id: "emerald", accent: "from-emerald-500/25 to-teal-600/10" },
  { id: "amber", accent: "from-amber-500/25 to-orange-700/10" },
  { id: "brand", accent: "from-brand-500/20 to-brand-600/10" },
  { id: "sky", accent: "from-sky-500/20 to-cyan-500/10" },
  { id: "indigo", accent: "from-indigo-500/25 to-blue-700/10" },
  { id: "lime", accent: "from-lime-500/20 to-green-700/10" },
  { id: "red", accent: "from-red-500/20 to-rose-600/10" },
  { id: "purple", accent: "from-purple-500/25 to-violet-800/10" },
  { id: "orange", accent: "from-orange-500/20 to-amber-900/10" },
  { id: "slate", accent: "from-slate-500/25 to-slate-600/10" },
  { id: "yellow", accent: "from-yellow-500/20 to-orange-600/10" },
  { id: "teal", accent: "from-teal-500/25 to-cyan-700/10" },
  { id: "blue", accent: "from-blue-500/25 to-slate-700/10" },
] as const;

export const CURATED_TOOL_ICONS = [
  "Globe",
  "Radio",
  "Webhook",
  "Wrench",
  "Puzzle",
  "Box",
  "Mail",
  "Server",
  "Phone",
  "Smartphone",
  "MessagesSquare",
  "MessageSquare",
  "CreditCard",
  "Table",
  "Hash",
  "Gamepad2",
  "Sparkles",
  "Brain",
  "Zap",
  "Database",
  "HardDrive",
  "Calendar",
  "Bot",
  "Code",
  "Cloud",
  "Link",
  "Send",
  "Inbox",
  "Users",
  "Building",
  "Key",
  "Lock",
  "Shield",
  "Workflow",
  "Plug",
  "Cable",
  "Cpu",
  "Layers",
  "LayoutGrid",
  "Settings",
  "Terminal",
  "FileJson",
  "Braces",
  "Activity",
  "Bell",
  "BookOpen",
  "Briefcase",
  "CircleDollarSign",
  "Headphones",
  "Heart",
  "Megaphone",
  "Mic",
  "Package",
  "PenLine",
  "Rocket",
  "Star",
  "Tag",
  "Target",
  "Timer",
  "TrendingUp",
  "Truck",
  "Video",
] as const;

function resolveLucideIcon(name: string): LucideIcon {
  const Cmp = (LucideIcons as unknown as Record<string, LucideIcon>)[name];
  return Cmp ?? LucideIcons.Box;
}

export function resolveAccentPreview(value: string): string {
  const preset = TOOL_UI_COLOR_PRESETS.find((p) => p.id === value || p.accent === value);
  if (preset) return preset.accent;
  if (value.trim().startsWith("from-")) return value.trim();
  return TOOL_UI_COLOR_PRESETS[0]!.accent;
}

function isPresetColor(value: string): boolean {
  return TOOL_UI_COLOR_PRESETS.some((p) => p.id === value || p.accent === value);
}

type Translate = (key: string) => string;

export function LucideIconPickerField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: Translate;
}) {
  const [query, setQuery] = useState("");
  const SelectedIcon = resolveLucideIcon(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...CURATED_TOOL_ICONS];
    return CURATED_TOOL_ICONS.filter((name) => name.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white/60 px-2 py-1.5 dark:border-ink-600 dark:bg-ink-950/60">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
          <SelectedIcon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("automationPage.toolsIconPickerSearch")}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-ink-400"
        />
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" />
      </div>
      <div className="max-h-36 overflow-y-auto rounded-lg border border-ink-200/80 p-2 dark:border-ink-700/80">
        <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
          {filtered.map((name) => {
            const Icon = resolveLucideIcon(name);
            const active = value === name;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => onChange(name)}
                className={clsx(
                  "flex h-8 w-full items-center justify-center rounded-lg border transition",
                  active
                    ? "border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-300"
                    : "border-transparent bg-ink-50 text-ink-600 hover:border-ink-200 hover:bg-ink-100 dark:bg-ink-900/50 dark:text-ink-300 dark:hover:border-ink-600",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
        {filtered.length === 0 ? (
          <p className="py-2 text-center text-[10px] text-ink-500">{t("automationPage.toolsIconPickerEmpty")}</p>
        ) : null}
      </div>
      <label className="block text-[10px] font-medium text-ink-500">
        {t("automationPage.toolsIconPickerCustom")}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-ink-600 dark:bg-ink-950"
        />
      </label>
    </div>
  );
}

export function UiAccentColorPickerField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: Translate;
}) {
  const [customMode, setCustomMode] = useState(() => !isPresetColor(value));
  const previewAccent = resolveAccentPreview(value);

  const selectedPresetId = TOOL_UI_COLOR_PRESETS.find((p) => p.id === value || p.accent === value)?.id;

  useEffect(() => {
    setCustomMode(!isPresetColor(value));
  }, [value]);

  return (
    <div className="mt-1 space-y-2">
      <div
        className={clsx(
          "flex items-center gap-3 rounded-lg border border-ink-200/80 bg-gradient-to-br px-3 py-2 dark:border-ink-700/80",
          previewAccent,
        )}
      >
        <div className="h-8 w-8 rounded-full bg-white/80 shadow-sm ring-2 ring-white/60 dark:bg-ink-900/80" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-700/90 dark:text-ink-100/90">
            {t("automationPage.toolsColorPickerPreview")}
          </p>
          <p className="truncate font-mono text-[10px] text-ink-600 dark:text-ink-300">{value || "cyan"}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-4">
        {TOOL_UI_COLOR_PRESETS.map((preset) => {
          const active = !customMode && selectedPresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.id}
              onClick={() => {
                setCustomMode(false);
                onChange(preset.id);
              }}
              className={clsx(
                "h-9 rounded-lg bg-gradient-to-br ring-2 ring-offset-1 ring-offset-white transition dark:ring-offset-ink-950",
                preset.accent,
                active ? "ring-brand-500" : "ring-transparent hover:ring-ink-300 dark:hover:ring-ink-600",
              )}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCustomMode((v) => !v)}
          className={clsx(
            "rounded-lg px-2 py-1 text-[10px] font-semibold transition",
            customMode
              ? "bg-brand-600 text-white"
              : "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300",
          )}
        >
          {t("automationPage.toolsColorPickerCustom")}
        </button>
      </div>

      {customMode ? (
        <label className="block text-[10px] font-medium text-ink-500">
          {t("automationPage.toolsCreateColor")}
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="from-cyan-500/30 to-blue-600/10"
            className="mt-0.5 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-ink-600 dark:bg-ink-950"
          />
        </label>
      ) : null}
    </div>
  );
}
