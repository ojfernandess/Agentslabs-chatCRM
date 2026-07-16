import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  CalendarClock,
  ChevronRight,
  Inbox,
  Loader2,
  MessageSquare,
  Phone,
  Play,
  Plus,
  Radio,
  Tags,
  Trash2,
  User,
  Variable,
} from "lucide-react";
import { api } from "@/lib/api";
import type { AutomationCustomToolRow } from "./automationToolTypes";
import {
  filterTemplatesForWhatsappInbox,
} from "@/lib/campaignTemplates";

type Translate = (key: string) => string;

type InboxOption = { id: string; name: string; channelType?: string; channelConfig?: unknown };
type TemplateOption = {
  id: string;
  name: string;
  body?: string;
  bodyVariableCount?: number;
  providerTemplateId?: string | null;
};
type TagOption = { id: string; name: string };

type VariableMapping = { key: string; jsonPath: string; label?: string };
type TemplateVarSlot = { slot: number; variableKey: string };

type PreviewResult = {
  ok: boolean;
  statusCode: number | null;
  sampleJson: unknown;
  suggestedFields: string[];
  mappedPreview: { phone: string; name: string; variables: Record<string, string> }[];
  arrayPath: string;
  totalRows: number;
  error: string | null;
};

type DispatchResult = {
  ok: boolean;
  fetched: number;
  mapped: number;
  contacts: number;
  skippedDuplicates: number;
  campaignId: string | null;
  previewBody?: string;
  error: string | null;
};

const STEPS = ["endpoint", "mapping", "inbox", "template", "execution"] as const;
type Step = (typeof STEPS)[number];

function fieldCls(extra?: string) {
  return clsx(
    "mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-950 dark:text-ink-100",
    extra,
  );
}

function readConfig(tool: AutomationCustomToolRow): Record<string, unknown> {
  return (tool.config ?? {}) as Record<string, unknown>;
}

function readDispatch(cfg: Record<string, unknown>): Record<string, unknown> {
  return (cfg.dispatch && typeof cfg.dispatch === "object" ? cfg.dispatch : {}) as Record<string, unknown>;
}

function readFieldMapping(cfg: Record<string, unknown>): Record<string, unknown> {
  return (cfg.fieldMapping && typeof cfg.fieldMapping === "object" ? cfg.fieldMapping : {}) as Record<string, unknown>;
}

export function HttpApiCustomToolBuilder({
  tool,
  t,
  onSave,
}: {
  tool: AutomationCustomToolRow;
  t: Translate;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const cfg0 = readConfig(tool);
  const dispatch0 = readDispatch(cfg0);
  const mapping0 = readFieldMapping(cfg0);

  const [step, setStep] = useState<Step>("endpoint");
  const [baseUrl, setBaseUrl] = useState(String(cfg0.baseUrl ?? ""));
  const [httpPath, setHttpPath] = useState(String(cfg0.httpPath ?? "/"));
  const [authType, setAuthType] = useState(String(cfg0.authType ?? "none"));
  const [bearerToken, setBearerToken] = useState("");
  const [apiKeyHeader, setApiKeyHeader] = useState(String(cfg0.apiKeyHeader ?? "X-Api-Key"));
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [responseArrayPath, setResponseArrayPath] = useState(String(cfg0.responseArrayPath ?? ""));
  const [phoneField, setPhoneField] = useState(String(mapping0.phone ?? "telefone"));
  const [nameField, setNameField] = useState(String(mapping0.name ?? "nome"));
  const [variables, setVariables] = useState<VariableMapping[]>(
    Array.isArray(mapping0.variables)
      ? (mapping0.variables as VariableMapping[]).map((v) => ({
          key: String(v.key ?? ""),
          jsonPath: String(v.jsonPath ?? ""),
          label: typeof v.label === "string" ? v.label : "",
        }))
      : [],
  );
  const [inboxId, setInboxId] = useState(String(dispatch0.inboxId ?? ""));
  const [messageType, setMessageType] = useState<"TEXT" | "TEMPLATE">(
    dispatch0.messageType === "TEMPLATE" ? "TEMPLATE" : "TEXT",
  );
  const [templateId, setTemplateId] = useState(String(dispatch0.templateId ?? ""));
  const [body, setBody] = useState(
    String(dispatch0.body ?? "Olá {{nome}}, sua fatura de {{valor}} vence em {{vencimento}}."),
  );
  const [templateSlots, setTemplateSlots] = useState<TemplateVarSlot[]>(
    Array.isArray(dispatch0.templateVariableMapping)
      ? (dispatch0.templateVariableMapping as TemplateVarSlot[])
      : [],
  );
  const [campaignKind, setCampaignKind] = useState<"broadcast" | "followup">(
    dispatch0.campaignKind === "followup" ? "followup" : "broadcast",
  );
  const [followUpAfterSend, setFollowUpAfterSend] = useState<"bot" | "human_handoff">(
    dispatch0.followUpAfterSend === "human_handoff" ? "human_handoff" : "bot",
  );
  const [avoidDuplicates, setAvoidDuplicates] = useState(dispatch0.avoidDuplicates !== false);
  const [autoCreateCampaign, setAutoCreateCampaign] = useState(dispatch0.autoCreateCampaign !== false);
  const [autoStart, setAutoStart] = useState(dispatch0.autoStart !== false);
  const [campaignName, setCampaignName] = useState(String(dispatch0.campaignName ?? ""));
  const [executionMode, setExecutionMode] = useState<"manual" | "scheduled">(
    dispatch0.executionMode === "scheduled" ? "scheduled" : "manual",
  );
  const [scheduledAt, setScheduledAt] = useState(String(dispatch0.scheduledAt ?? ""));

  const [inboxes, setInboxes] = useState<InboxOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    Array.isArray(dispatch0.followUpTagIds) ? (dispatch0.followUpTagIds as string[]) : [],
  );
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.get<{ data: InboxOption[] }>("/inboxes").then((res) => {
      setInboxes((res.data ?? []).filter((i) => i.channelType === "WHATSAPP" || !i.channelType));
    }).catch(() => setInboxes([]));
    void api.get<TagOption[]>("/tags").then((res) => setTags(Array.isArray(res) ? res : [])).catch(() => setTags([]));
  }, []);

  const loadTemplates = useCallback(async (nextInboxId: string) => {
    if (!nextInboxId) {
      setTemplates([]);
      return;
    }
    setTemplatesLoading(true);
    try {
      const res = await api.get<TemplateOption[]>(`/templates?inboxId=${encodeURIComponent(nextInboxId)}&sync=1`);
      const inbox = inboxes.find((i) => i.id === nextInboxId);
      setTemplates(
        filterTemplatesForWhatsappInbox(Array.isArray(res) ? res : [], inbox, { allowVariableTemplates: true }),
      );
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [inboxes]);

  useEffect(() => {
    if (inboxId) void loadTemplates(inboxId);
  }, [inboxId, loadTemplates]);

  const variableKeys = useMemo(() => {
    const keys = new Set<string>(["nome", "telefone"]);
    for (const v of variables) if (v.key.trim()) keys.add(v.key.trim());
    return [...keys];
  }, [variables]);

  const buildPatch = useCallback((): Record<string, unknown> => {
    const patch: Record<string, unknown> = {
      baseUrl: baseUrl.trim(),
      httpMethod: "GET",
      httpPath: httpPath.trim() || "/",
      authType,
      responseArrayPath: responseArrayPath.trim(),
      fieldMapping: {
        phone: phoneField.trim(),
        name: nameField.trim(),
        variables: variables.filter((v) => v.key.trim() && v.jsonPath.trim()),
      },
      dispatch: {
        inboxId: inboxId || undefined,
        messageType,
        templateId: messageType === "TEMPLATE" ? templateId || undefined : undefined,
        body: messageType === "TEXT" ? body : body || undefined,
        templateVariableMapping: messageType === "TEMPLATE" ? templateSlots : undefined,
        executionMode,
        scheduledAt: executionMode === "scheduled" && scheduledAt ? scheduledAt : undefined,
        autoCreateCampaign,
        autoStart,
        avoidDuplicates,
        campaignKind,
        followUpAfterSend: campaignKind === "followup" ? followUpAfterSend : undefined,
        followUpTagIds: campaignKind === "followup" ? selectedTagIds : undefined,
        campaignName: campaignName.trim() || undefined,
      },
    };
    if (bearerToken.trim() && bearerToken !== "***") patch.bearerToken = bearerToken.trim();
    if (apiKeyValue.trim() && apiKeyValue !== "***") {
      patch.apiKeyHeader = apiKeyHeader.trim();
      patch.apiKeyValue = apiKeyValue.trim();
    }
    return patch;
  }, [
    apiKeyHeader,
    apiKeyValue,
    authType,
    autoCreateCampaign,
    autoStart,
    avoidDuplicates,
    baseUrl,
    body,
    bearerToken,
    campaignKind,
    campaignName,
    executionMode,
    followUpAfterSend,
    httpPath,
    inboxId,
    messageType,
    nameField,
    phoneField,
    responseArrayPath,
    scheduledAt,
    selectedTagIds,
    templateId,
    templateSlots,
    variables,
  ]);

  const saveCurrent = useCallback(() => {
    onSave(buildPatch());
  }, [buildPatch, onSave]);

  const runPreview = async () => {
    setError("");
    setPreviewBusy(true);
    saveCurrent();
    try {
      await new Promise((r) => setTimeout(r, 250));
      const res = await api.post<PreviewResult>(`/automation/custom-tools/${tool.id}/custom-preview`, {});
      setPreview(res);
      if (!res.ok) setError(res.error ?? t("automationPage.httpCustomPreviewFailed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("automationPage.httpCustomPreviewFailed"));
    } finally {
      setPreviewBusy(false);
    }
  };

  const runDispatch = async (dryRun: boolean) => {
    setError("");
    setDispatchBusy(true);
    saveCurrent();
    try {
      await new Promise((r) => setTimeout(r, 250));
      const res = await api.post<DispatchResult>(`/automation/custom-tools/${tool.id}/custom-dispatch`, { dryRun });
      setDispatchResult(res);
      if (!res.ok) setError(res.error ?? t("automationPage.httpCustomDispatchFailed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("automationPage.httpCustomDispatchFailed"));
    } finally {
      setDispatchBusy(false);
    }
  };

  const addVariable = () => {
    setVariables((prev) => [...prev, { key: "", jsonPath: "", label: "" }]);
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="mt-3 space-y-4 border-t border-ink-200 pt-4 dark:border-ink-700">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-600 dark:text-ink-300">
        <Radio className="h-4 w-4 text-brand-600" />
        {t("automationPage.httpCustomTitle")}
      </div>

      <div className="flex flex-wrap gap-1">
        {STEPS.map((s, idx) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={clsx(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
              step === s
                ? "bg-brand-600 text-white"
                : "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300",
            )}
          >
            {idx + 1}. {t(`automationPage.httpCustomStep_${s}`)}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {step === "endpoint" ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{t("automationPage.httpCustomEndpointHelp")}</p>
          <label className="block text-xs font-medium">
            Base URL
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={fieldCls()} />
          </label>
          <label className="block text-xs font-medium">
            Path (GET)
            <input value={httpPath} onChange={(e) => setHttpPath(e.target.value)} className={fieldCls("font-mono")} />
          </label>
          <label className="block text-xs font-medium">
            {t("automationPage.httpCustomArrayPath")}
            <input
              value={responseArrayPath}
              onChange={(e) => setResponseArrayPath(e.target.value)}
              placeholder="data.contacts"
              className={fieldCls("font-mono")}
            />
          </label>
          <label className="block text-xs font-medium">
            Auth
            <select value={authType} onChange={(e) => setAuthType(e.target.value)} className={fieldCls()}>
              <option value="none">none</option>
              <option value="bearer">Bearer</option>
              <option value="api_key">API Key</option>
              <option value="basic">Basic</option>
            </select>
          </label>
          {authType === "bearer" ? (
            <label className="block text-xs font-medium">
              Bearer token
              <input type="password" value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} className={fieldCls()} />
            </label>
          ) : null}
          {authType === "api_key" ? (
            <>
              <label className="block text-xs font-medium">
                Header
                <input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} className={fieldCls()} />
              </label>
              <label className="block text-xs font-medium">
                API Key
                <input type="password" value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} className={fieldCls()} />
              </label>
            </>
          ) : null}
          <button
            type="button"
            disabled={previewBusy}
            onClick={() => void runPreview()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {previewBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {t("automationPage.httpCustomTestEndpoint")}
          </button>
          {preview ? (
            <div className="rounded-xl border border-ink-200 bg-ink-50/80 p-3 dark:border-ink-700 dark:bg-ink-900/40">
              <p className="text-[11px] font-semibold text-ink-600">
                {preview.ok
                  ? t("automationPage.httpCustomPreviewOk").replace("{n}", String(preview.totalRows))
                  : t("automationPage.httpCustomPreviewError")}
                {preview.statusCode != null ? ` · HTTP ${preview.statusCode}` : ""}
              </p>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-ink-950 p-2 font-mono text-[10px] text-ink-100">
                {JSON.stringify(preview.sampleJson, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "mapping" ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{t("automationPage.httpCustomMappingHelp")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {t("automationPage.httpCustomFieldPhone")}</span>
              <input value={phoneField} onChange={(e) => setPhoneField(e.target.value)} list="http-custom-fields" className={fieldCls("font-mono")} />
            </label>
            <label className="block text-xs font-medium">
              <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {t("automationPage.httpCustomFieldName")}</span>
              <input value={nameField} onChange={(e) => setNameField(e.target.value)} list="http-custom-fields" className={fieldCls("font-mono")} />
            </label>
          </div>
          <datalist id="http-custom-fields">
            {(preview?.suggestedFields ?? []).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-700 dark:text-ink-200">
                <Variable className="mr-1 inline h-3.5 w-3.5" />
                {t("automationPage.httpCustomVariables")}
              </span>
              <button type="button" onClick={addVariable} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600">
                <Plus className="h-3 w-3" /> {t("automationPage.httpCustomAddVariable")}
              </button>
            </div>
            {variables.map((v, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input
                  value={v.key}
                  onChange={(e) => setVariables((prev) => prev.map((row, i) => (i === idx ? { ...row, key: e.target.value } : row)))}
                  placeholder="{{variavel}}"
                  className={fieldCls("font-mono")}
                />
                <input
                  value={v.jsonPath}
                  onChange={(e) => setVariables((prev) => prev.map((row, i) => (i === idx ? { ...row, jsonPath: e.target.value } : row)))}
                  placeholder="campo.json"
                  list="http-custom-fields"
                  className={fieldCls("font-mono")}
                />
                <button
                  type="button"
                  onClick={() => setVariables((prev) => prev.filter((_, i) => i !== idx))}
                  className="rounded-lg border border-ink-200 px-2 text-ink-500 dark:border-ink-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {preview?.mappedPreview?.length ? (
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/20">
              <p className="font-semibold text-emerald-900 dark:text-emerald-100">{t("automationPage.httpCustomMappedPreview")}</p>
              <pre className="mt-2 overflow-auto font-mono text-[10px]">{JSON.stringify(preview.mappedPreview, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "inbox" ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{t("automationPage.httpCustomInboxHelp")}</p>
          <label className="block text-xs font-medium">
            <span className="inline-flex items-center gap-1"><Inbox className="h-3 w-3" /> {t("automationPage.httpCustomInbox")}</span>
            <select value={inboxId} onChange={(e) => setInboxId(e.target.value)} className={fieldCls()}>
              <option value="">{t("automationPage.httpCustomSelectInbox")}</option>
              {inboxes.map((inbox) => (
                <option key={inbox.id} value={inbox.id}>{inbox.name}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {step === "template" ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{t("automationPage.httpCustomTemplateHelp")}</p>
          <div className="flex gap-2">
            {(["TEXT", "TEMPLATE"] as const).map((mt) => (
              <button
                key={mt}
                type="button"
                onClick={() => setMessageType(mt)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  messageType === mt ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 dark:bg-ink-800",
                )}
              >
                {mt === "TEXT" ? t("automationPage.httpCustomMessageText") : t("automationPage.httpCustomMessageTemplate")}
              </button>
            ))}
          </div>
          {messageType === "TEMPLATE" ? (
            <label className="block text-xs font-medium">
              Template
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={fieldCls()} disabled={templatesLoading}>
                <option value="">{templatesLoading ? "…" : t("automationPage.httpCustomSelectTemplate")}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-xs font-medium">
              <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Body</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={fieldCls()} />
            </label>
          )}
          {messageType === "TEMPLATE" ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-ink-600">{t("automationPage.httpCustomTemplateSlots")}</p>
              {templateSlots.map((slot, idx) => (
                <div key={idx} className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={slot.slot}
                    onChange={(e) =>
                      setTemplateSlots((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, slot: Number(e.target.value) } : row)),
                      )
                    }
                    className={fieldCls()}
                  />
                  <select
                    value={slot.variableKey}
                    onChange={(e) =>
                      setTemplateSlots((prev) =>
                        prev.map((row, i) => (i === idx ? { ...row, variableKey: e.target.value } : row)),
                      )
                    }
                    className={fieldCls()}
                  >
                    <option value="">—</option>
                    {variableKeys.map((k) => (
                      <option key={k} value={k}>{`{{${k}}}`}</option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setTemplateSlots((prev) => [...prev, { slot: prev.length + 1, variableKey: "nome" }])}
                className="text-[11px] font-semibold text-brand-600"
              >
                + slot
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {variableKeys.map((k) => (
              <span key={k} className="rounded-full bg-brand-100 px-2 py-0.5 font-mono text-[10px] text-brand-800 dark:bg-brand-950/40 dark:text-brand-200">
                {`{{${k}}}`}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {step === "execution" ? (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{t("automationPage.httpCustomExecutionHelp")}</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={avoidDuplicates} onChange={(e) => setAvoidDuplicates(e.target.checked)} />
            {t("automationPage.httpCustomAvoidDuplicates")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={autoCreateCampaign} onChange={(e) => setAutoCreateCampaign(e.target.checked)} />
            {t("automationPage.httpCustomAutoCampaign")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} disabled={!autoCreateCampaign} />
            {t("automationPage.httpCustomAutoStart")}
          </label>
          <label className="block text-xs font-medium">
            {t("automationPage.httpCustomCampaignName")}
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} className={fieldCls()} />
          </label>
          <div className="flex gap-2">
            {(["broadcast", "followup"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setCampaignKind(kind)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold",
                  campaignKind === kind ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700 dark:bg-ink-800",
                )}
              >
                {kind === "followup" ? t("automationPage.httpCustomFollowUp") : t("automationPage.httpCustomBroadcast")}
              </button>
            ))}
          </div>
          {campaignKind === "followup" ? (
            <>
              <label className="block text-xs font-medium">
                {t("automationPage.httpCustomFollowUpAfter")}
                <select value={followUpAfterSend} onChange={(e) => setFollowUpAfterSend(e.target.value as "bot" | "human_handoff")} className={fieldCls()}>
                  <option value="bot">{t("automationPage.httpCustomFollowUpBot")}</option>
                  <option value="human_handoff">{t("automationPage.httpCustomFollowUpHuman")}</option>
                </select>
              </label>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-ink-600"><Tags className="mr-1 inline h-3 w-3" />{t("automationPage.httpCustomFollowUpTags")}</p>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <label key={tag.id} className="inline-flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={selectedTagIds.includes(tag.id)}
                        onChange={(e) =>
                          setSelectedTagIds((prev) =>
                            e.target.checked ? [...prev, tag.id] : prev.filter((id) => id !== tag.id),
                          )
                        }
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          <label className="block text-xs font-medium">
            <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {t("automationPage.httpCustomSchedule")}</span>
            <select value={executionMode} onChange={(e) => setExecutionMode(e.target.value as "manual" | "scheduled")} className={fieldCls()}>
              <option value="manual">{t("automationPage.httpCustomScheduleManual")}</option>
              <option value="scheduled">{t("automationPage.httpCustomScheduleLater")}</option>
            </select>
          </label>
          {executionMode === "scheduled" ? (
            <label className="block text-xs font-medium">
              scheduledAt (ISO)
              <input value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={fieldCls("font-mono")} />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={dispatchBusy}
              onClick={() => void runDispatch(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-xs font-semibold dark:border-ink-600 disabled:opacity-50"
            >
              {dispatchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              {t("automationPage.httpCustomDryRun")}
            </button>
            <button
              type="button"
              disabled={dispatchBusy}
              onClick={() => void runDispatch(false)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {dispatchBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t("automationPage.httpCustomDispatch")}
            </button>
          </div>
          {dispatchResult ? (
            <div className="rounded-xl border border-ink-200 bg-white/70 p-3 text-xs dark:border-ink-700 dark:bg-ink-900/40">
              <p>{t("automationPage.httpCustomDispatchSummary")
                .replace("{fetched}", String(dispatchResult.fetched))
                .replace("{mapped}", String(dispatchResult.mapped))
                .replace("{contacts}", String(dispatchResult.contacts))
                .replace("{skipped}", String(dispatchResult.skippedDuplicates))}
              </p>
              {dispatchResult.previewBody ? (
                <p className="mt-2 rounded-lg bg-ink-50 p-2 dark:bg-ink-950">{dispatchResult.previewBody}</p>
              ) : null}
              {dispatchResult.campaignId ? (
                <a href={`/broadcasts`} className="mt-2 inline-flex items-center gap-1 font-semibold text-brand-600">
                  {t("automationPage.httpCustomOpenCampaigns")} <ChevronRight className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-ink-200 pt-3 dark:border-ink-700">
        <button
          type="button"
          disabled={stepIndex <= 0}
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)]!)}
          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-ink-600"
        >
          {t("automationPage.httpCustomPrev")}
        </button>
        <button type="button" onClick={saveCurrent} className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-ink-200 dark:text-ink-900">
          {t("automationPage.toolSaveCredentials")}
        </button>
        <button
          type="button"
          disabled={stepIndex >= STEPS.length - 1}
          onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]!)}
          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-ink-600"
        >
          {t("automationPage.httpCustomNext")}
        </button>
      </div>
    </div>
  );
}
