import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Cloud, FileText, Zap } from "lucide-react";
import { motion, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import {
  isInboxWhatsappConfigured,
  isWhatsAppCloudApiProvider,
  parseInboxWhatsappFromChannelConfig,
} from "@/lib/inboxWhatsappConfig";
import { isOrgWhatsappConfigured, type WhatsappOrgSettingsSnapshot } from "@/lib/whatsappOrgConfig";
import {
  settingsCard,
  settingsMuted,
  settingsTitle,
} from "@/components/settings/settingsUi";
import { EvolutionTemplateBuilder, type EvolutionTemplateInboxOption } from "./EvolutionTemplateBuilder";
import { EvolutionTemplateEditModal } from "./EvolutionTemplateEditModal";
import {
  MessageTemplatesTable,
  MessageTemplatesTableHeader,
  type MessageTemplateRow,
} from "./MessageTemplatesTable";

type TemplatesPanel = "meta" | "evolution";

interface WaInboxRow {
  id: string;
  name?: string;
  isDefault?: boolean;
  channelConfig?: unknown;
}

interface Props {
  waInboxes: WaInboxRow[];
  defaultWaInboxId?: string;
  orgSettings: WhatsappOrgSettingsSnapshot | null;
}

function isMetaTemplateRow(row: MessageTemplateRow): boolean {
  return Boolean(row.providerTemplateId?.trim());
}

function isEvolutionTemplateRow(row: MessageTemplateRow): boolean {
  return !row.providerTemplateId?.trim();
}

export function WhatsAppMessageTemplatesSection({ waInboxes, defaultWaInboxId, orgSettings }: Props) {
  const { t } = useI18n();

  const metaInboxes = useMemo(() => {
    const rows = waInboxes
      .map((inbox) => {
        const fields = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
        if (!fields.whatsappProvider || !isWhatsAppCloudApiProvider(fields.whatsappProvider)) return null;
        if (!isInboxWhatsappConfigured(fields)) return null;
        return {
          id: inbox.id,
          name: inbox.name?.trim() || t("settings.templatesMetaInboxFallback"),
        };
      })
      .filter((x): x is { id: string; name: string } => x != null);

    if (rows.length > 0) return rows;

    if (
      orgSettings?.whatsappProvider &&
      isWhatsAppCloudApiProvider(orgSettings.whatsappProvider) &&
      isOrgWhatsappConfigured(orgSettings) &&
      defaultWaInboxId
    ) {
      return [{ id: defaultWaInboxId, name: t("settings.templatesMetaOrgFallback") }];
    }
    return [];
  }, [waInboxes, orgSettings, defaultWaInboxId, t]);

  const evolutionInboxes = useMemo<EvolutionTemplateInboxOption[]>(
    () =>
      waInboxes
        .map((inbox) => {
          const fields = parseInboxWhatsappFromChannelConfig(inbox.channelConfig);
          if (fields.whatsappProvider !== "evolution" && fields.whatsappProvider !== "evolution_go") return null;
          if (!isInboxWhatsappConfigured(fields)) return null;
          return {
            id: inbox.id,
            name: inbox.name?.trim() || t("settings.templatesEvolutionInboxFallback"),
            provider: fields.whatsappProvider as "evolution" | "evolution_go",
          };
        })
        .filter((x): x is EvolutionTemplateInboxOption => x != null),
    [waInboxes, t],
  );

  const showMeta = metaInboxes.length > 0;
  const showEvolution = evolutionInboxes.length > 0;

  const [panel, setPanel] = useState<TemplatesPanel>("meta");
  const [metaInboxId, setMetaInboxId] = useState("");
  const [metaRows, setMetaRows] = useState<MessageTemplateRow[]>([]);
  const [evolutionRows, setEvolutionRows] = useState<MessageTemplateRow[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  const [metaSyncBusy, setMetaSyncBusy] = useState(false);
  const [metaSyncResult, setMetaSyncResult] = useState<{ synced: number } | null>(null);
  const [metaSyncError, setMetaSyncError] = useState("");
  const [evolutionListInboxId, setEvolutionListInboxId] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplateRow | null>(null);

  useEffect(() => {
    if (metaInboxes.length === 0) {
      setMetaInboxId("");
      return;
    }
    setMetaInboxId((prev) => (prev && metaInboxes.some((i) => i.id === prev) ? prev : metaInboxes[0].id));
  }, [metaInboxes]);

  useEffect(() => {
    if (evolutionInboxes.length === 0) {
      setEvolutionListInboxId("");
      return;
    }
    setEvolutionListInboxId((prev) =>
      prev && evolutionInboxes.some((i) => i.id === prev) ? prev : evolutionInboxes[0].id,
    );
  }, [evolutionInboxes]);

  useEffect(() => {
    if (panel === "meta" && !showMeta && showEvolution) setPanel("evolution");
    if (panel === "evolution" && !showEvolution && showMeta) setPanel("meta");
    if (!showMeta && !showEvolution) return;
    if (showMeta && !showEvolution) setPanel("meta");
    if (!showMeta && showEvolution) setPanel("evolution");
  }, [showMeta, showEvolution, panel]);

  const loadMetaTemplates = useCallback(
    async (opts?: { sync?: boolean }) => {
      if (!metaInboxId) {
        setMetaRows([]);
        return;
      }
      setMetaLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("inboxId", metaInboxId);
        if (opts?.sync) params.set("sync", "1");
        const list = await api.get<MessageTemplateRow[]>(`/templates?${params.toString()}`);
        const rows = Array.isArray(list) ? list : [];
        setMetaRows(rows.filter(isMetaTemplateRow));
      } catch {
        setMetaRows([]);
      } finally {
        setMetaLoading(false);
      }
    },
    [metaInboxId],
  );

  const loadEvolutionTemplates = useCallback(async () => {
    if (!evolutionListInboxId) {
      setEvolutionRows([]);
      return;
    }
    setEvolutionLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("inboxId", evolutionListInboxId);
      const list = await api.get<MessageTemplateRow[]>(`/templates?${params.toString()}`);
      const rows = Array.isArray(list) ? list : [];
      setEvolutionRows(rows.filter(isEvolutionTemplateRow));
    } catch {
      setEvolutionRows([]);
    } finally {
      setEvolutionLoading(false);
    }
  }, [evolutionListInboxId]);

  const handleDeleteEvolutionTemplate = async (row: MessageTemplateRow) => {
    if (!window.confirm(t("settings.evoTplDeleteConfirm").replace("{name}", row.name))) return;
    try {
      await api.delete(`/templates/${row.id}`);
      await loadEvolutionTemplates();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t("settings.evoTplDeleteFailed"));
    }
  };

  useEffect(() => {
    if (showMeta) void loadMetaTemplates();
  }, [showMeta, loadMetaTemplates]);

  useEffect(() => {
    if (showEvolution && evolutionListInboxId) void loadEvolutionTemplates();
  }, [showEvolution, evolutionListInboxId, loadEvolutionTemplates]);

  const syncMetaTemplates = async () => {
    setMetaSyncBusy(true);
    setMetaSyncError("");
    setMetaSyncResult(null);
    try {
      const q = metaInboxId ? `?inboxId=${encodeURIComponent(metaInboxId)}` : "";
      const result = await api.post<{ synced: number; wabaId: string | null }>(`/templates/meta/sync${q}`);
      setMetaSyncResult({ synced: result.synced });
      await loadMetaTemplates({ sync: true });
      if (result.synced === 0 && !result.wabaId) {
        setMetaSyncError(t("settings.templatesMetaListEmptySync"));
      }
    } catch (err) {
      setMetaSyncError(err instanceof Error ? err.message : t("settings.templatesMetaSyncFailed"));
    } finally {
      setMetaSyncBusy(false);
    }
  };

  return (
    <motion.div className="space-y-6" variants={staggerItem}>
      <div className={settingsCard}>
        <h2 className={clsx("mb-2 flex items-center gap-2", settingsTitle)}>
          <FileText className="h-5 w-5" />
          {t("settings.templatesTitle")}
        </h2>
        <p className={settingsMuted}>{t("settings.templatesPageIntro")}</p>

        {showMeta || showEvolution ? (
          <div className="mt-4 flex flex-wrap gap-2 border-b border-ink-200/80 pb-1 dark:border-white/10">
            {showMeta ? (
              <button
                type="button"
                onClick={() => setPanel("meta")}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold transition-colors",
                  panel === "meta"
                    ? "border-brand-500 text-brand-700 dark:text-brand-300"
                    : "border-transparent text-ink-500 hover:text-ink-800",
                )}
              >
                <Cloud className="h-4 w-4" />
                {t("settings.templatesTabMeta")}
                {metaRows.length > 0 ? (
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs dark:bg-white/10">{metaRows.length}</span>
                ) : null}
              </button>
            ) : null}
            {showEvolution ? (
              <button
                type="button"
                onClick={() => setPanel("evolution")}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold transition-colors",
                  panel === "evolution"
                    ? "border-brand-500 text-brand-700 dark:text-brand-300"
                    : "border-transparent text-ink-500 hover:text-ink-800",
                )}
              >
                <Zap className="h-4 w-4" />
                {t("settings.templatesTabEvolution")}
                {evolutionRows.length > 0 ? (
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs dark:bg-white/10">{evolutionRows.length}</span>
                ) : null}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
            {t("settings.templatesNoneConfigured")}
          </p>
        )}
      </div>

      {panel === "meta" && showMeta ? (
        <motion.div className={settingsCard} variants={staggerItem}>
          <p className={clsx("mb-4", settingsMuted)}>{t("settings.templatesMetaHint")}</p>
          {metaInboxes.length > 1 ? (
            <div className="mb-4">
              <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                {t("settings.templatesMetaInboxLabel")}
              </label>
              <select
                className="input mt-1 w-full max-w-md"
                value={metaInboxId}
                onChange={(e) => setMetaInboxId(e.target.value)}
              >
                {metaInboxes.map((inbox) => (
                  <option key={inbox.id} value={inbox.id}>
                    {inbox.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={metaSyncBusy || metaLoading}
              onClick={() => void syncMetaTemplates()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {metaSyncBusy ? t("settings.templatesMetaSyncing") : t("settings.templatesMetaSync")}
            </button>
            <button
              type="button"
              disabled={metaLoading}
              onClick={() => void loadMetaTemplates()}
              className="btn-secondary text-sm"
            >
              {t("common.refresh")}
            </button>
          </div>
          {metaSyncResult ? (
            <p className="mb-3 text-sm text-green-700 dark:text-green-400">
              {t("settings.templatesMetaSyncOk").replace("{count}", String(metaSyncResult.synced))}
            </p>
          ) : null}
          {metaSyncError ? (
            <p className="mb-3 text-sm text-red-600 dark:text-red-400" role="alert">
              {metaSyncError}
            </p>
          ) : null}
          <MessageTemplatesTableHeader title={t("settings.templatesMetaListTitle")} />
          <MessageTemplatesTable
            rows={metaRows}
            loading={metaLoading}
            emptyMessage={t("settings.templatesMetaListEmpty")}
            showSource
          />
        </motion.div>
      ) : null}

      {panel === "evolution" && showEvolution ? (
        <>
          <EvolutionTemplateBuilder
            inboxes={evolutionInboxes}
            onCreated={(inboxId) => {
              setEvolutionListInboxId(inboxId);
              void loadEvolutionTemplates();
            }}
          />
          <motion.div className={settingsCard} variants={staggerItem}>
            {evolutionInboxes.length > 1 ? (
              <div className="mb-4">
                <label className="text-xs font-semibold text-ink-600 dark:text-ink-400">
                  {t("settings.templatesEvolutionInboxLabel")}
                </label>
                <select
                  className="input mt-1 w-full max-w-md"
                  value={evolutionListInboxId}
                  onChange={(e) => setEvolutionListInboxId(e.target.value)}
                >
                  {evolutionInboxes.map((inbox) => (
                    <option key={inbox.id} value={inbox.id}>
                      {inbox.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <MessageTemplatesTableHeader title={t("settings.templatesEvolutionListTitle")}>
              <button
                type="button"
                disabled={evolutionLoading}
                onClick={() => void loadEvolutionTemplates()}
                className="btn-secondary text-sm"
              >
                {t("common.refresh")}
              </button>
            </MessageTemplatesTableHeader>
            <MessageTemplatesTable
              rows={evolutionRows}
              loading={evolutionLoading}
              emptyMessage={t("settings.templatesEvolutionListEmpty")}
              manageable
              onEdit={(row) => setEditingTemplate(row)}
              onDelete={(row) => void handleDeleteEvolutionTemplate(row)}
            />
          </motion.div>
          <EvolutionTemplateEditModal
            template={editingTemplate}
            onClose={() => setEditingTemplate(null)}
            onSaved={() => void loadEvolutionTemplates()}
          />
        </>
      ) : null}
    </motion.div>
  );
}
