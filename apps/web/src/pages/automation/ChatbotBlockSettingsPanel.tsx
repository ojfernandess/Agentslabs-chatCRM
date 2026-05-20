import { Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { getBlockMeta } from "./chatbotBlockMeta";
import type { ChatbotFlowNode } from "./chatbotFlowTypes";

interface TagOption {
  id: string;
  name: string;
  color?: string;
}

interface Props {
  node: ChatbotFlowNode | null;
  allNodes: ChatbotFlowNode[];
  tags?: TagOption[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}

export function ChatbotBlockSettingsPanel({ node, allNodes, tags = [], onUpdate, onDelete }: Props) {
  const { t } = useI18n();

  if (!node) {
    return (
      <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-ink-200/80 bg-[#fafbfc] dark:border-ink-800 dark:bg-[#12141c]">
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <p className="text-sm font-medium text-ink-600 dark:text-ink-400">{t("chatbotPage.settingsEmpty")}</p>
          <p className="mt-1 text-xs text-ink-400">{t("chatbotPage.settingsEmptyHint")}</p>
        </div>
      </aside>
    );
  }

  const meta = getBlockMeta(node.type);
  const Icon = meta.icon;
  const data = node.data ?? {};
  const canDelete = node.type !== "start" && node.type !== "end";

  const hasPromptField =
    node.type === "text_input" ||
    node.type === "choice_input" ||
    node.type === "email_input" ||
    node.type === "number_input" ||
    node.type === "phone_input" ||
    node.type === "date_input" ||
    node.type === "rating_input";
  const hasVariableNameField =
    hasPromptField || node.type === "set_variable";

  const patch = (p: Record<string, unknown>) => onUpdate(node.id, { ...data, ...p });

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-ink-200/80 bg-[#fafbfc] dark:border-ink-800 dark:bg-[#12141c]">
      <div className="border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: meta.color }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink-900 dark:text-ink-50">{t(meta.labelKey)}</p>
            <p className="text-[10px] text-ink-500">{t("chatbotPage.settingsTitle")}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {(node.type === "text" || hasPromptField) && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">
              {node.type === "text" ? t("chatbotPage.contentPlaceholder") : t("chatbotPage.promptPlaceholder")}
            </span>
            <textarea
              rows={4}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.content ?? data.prompt ?? "")}
              onChange={(e) =>
                patch(node.type === "text" ? { content: e.target.value } : { prompt: e.target.value, content: e.target.value })
              }
            />
          </label>
        )}

        {hasVariableNameField && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.variableName")}</span>
            <input
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.variableName ?? data.name ?? "")}
              onChange={(e) =>
                patch(node.type === "set_variable" ? { name: e.target.value } : { variableName: e.target.value })
              }
            />
          </label>
        )}

        {node.type === "choice_input" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.choiceDisplayMode")}</span>
            <select
              className="mb-2 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.displayMode ?? "text")}
              onChange={(e) => patch({ displayMode: e.target.value })}
            >
              <option value="text">{t("chatbotPage.choiceModeText")}</option>
              <option value="buttons">{t("chatbotPage.choiceModeButtons")}</option>
            </select>
          </label>
        )}

        {node.type === "choice_input" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.choicesLabel")}</span>
            <textarea
              rows={3}
              placeholder={t("chatbotPage.choicesPlaceholder")}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={
                Array.isArray(data.choices)
                  ? (data.choices as { label?: string }[]).map((c) => c.label ?? "").join("\n")
                  : t("chatbotPage.choicesPlaceholder")
              }
              onChange={(e) => {
                const choices = e.target.value
                  .split("\n")
                  .map((label, i) => ({ id: String(i + 1), label: label.trim() }))
                  .filter((c) => c.label);
                patch({ choices });
              }}
            />
          </label>
        )}

        {node.type === "number_input" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.numberMin")}</span>
              <input
                type="number"
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={data.min != null && data.min !== "" ? String(data.min) : ""}
                placeholder="—"
                onChange={(e) => patch({ min: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.numberMax")}</span>
              <input
                type="number"
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={data.max != null && data.max !== "" ? String(data.max) : ""}
                placeholder="—"
                onChange={(e) => patch({ max: e.target.value === "" ? undefined : Number(e.target.value) })}
              />
            </label>
          </div>
        )}

        {node.type === "rating_input" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.ratingMin")}</span>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.ratingMin ?? 1)}
                onChange={(e) => patch({ ratingMin: Number(e.target.value) || 1 })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.ratingMax")}</span>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.ratingMax ?? 5)}
                onChange={(e) => patch({ ratingMax: Number(e.target.value) || 5 })}
              />
            </label>
          </div>
        )}

        {(node.type === "image" || node.type === "video" || node.type === "audio") && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">URL</span>
            <input
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              placeholder="https://"
              value={String(data.url ?? "")}
              onChange={(e) => patch({ url: e.target.value })}
            />
          </label>
        )}

        {node.type === "webhook" && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">URL</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder="https://"
                value={String(data.url ?? "")}
                onChange={(e) => patch({ url: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.webhookMethod")}</span>
              <select
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.method ?? "POST")}
                onChange={(e) => patch({ method: e.target.value })}
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.webhookResponseVar")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.responseVariable ?? "webhook_response")}
                onChange={(e) => patch({ responseVariable: e.target.value })}
              />
            </label>
          </>
        )}

        {node.type === "add_tag" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.tagLabel")}</span>
            <select
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.tagId ?? "")}
              onChange={(e) => patch({ tagId: e.target.value })}
            >
              <option value="">{t("chatbotPage.selectTag")}</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {node.type === "ab_test" && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.abVariants")}</span>
              <textarea
                rows={3}
                placeholder={t("chatbotPage.abVariantsPlaceholder")}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={
                  Array.isArray(data.variants)
                    ? (data.variants as { id?: string; weight?: number }[])
                        .map((v) => `${v.id ?? "a"}:${v.weight ?? 50}`)
                        .join("\n")
                    : "a:50\nb:50"
                }
                onChange={(e) => {
                  const variants = e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line, i) => {
                      const [idPart, weightPart] = line.split(":").map((x) => x.trim());
                      return {
                        id: idPart || String.fromCharCode(97 + i),
                        weight: Number(weightPart) || 50,
                      };
                    });
                  patch({ variants: variants.length ? variants : [{ id: "a", weight: 50 }, { id: "b", weight: 50 }] });
                }}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.abVariable")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder="_ab_node"
                value={String(data.variableName ?? "")}
                onChange={(e) => patch({ variableName: e.target.value })}
              />
            </label>
            <p className="text-[10px] text-ink-400">{t("chatbotPage.abHint")}</p>
          </>
        )}

        {node.type === "script" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.scriptCode")}</span>
            <textarea
              rows={5}
              placeholder={t("chatbotPage.scriptPlaceholder")}
              className="w-full font-mono rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.code ?? data.script ?? "")}
              onChange={(e) => patch({ code: e.target.value })}
            />
            <p className="mt-1 text-[10px] text-ink-400">{t("chatbotPage.scriptHint")}</p>
          </label>
        )}

        {node.type === "redirect" && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">URL</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder="https://"
                value={String(data.url ?? "")}
                onChange={(e) => patch({ url: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.redirectMessage")}</span>
              <textarea
                rows={2}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder={t("chatbotPage.redirectMessageHint")}
                value={String(data.message ?? data.content ?? "")}
                onChange={(e) => patch({ message: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.variableName")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.variableName ?? "redirect_url")}
                onChange={(e) => patch({ variableName: e.target.value })}
              />
            </label>
          </>
        )}

        {node.type === "openai" && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.openaiPrompt")}</span>
              <textarea
                rows={3}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.prompt ?? data.content ?? "")}
                onChange={(e) => patch({ prompt: e.target.value, content: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.openaiSystem")}</span>
              <textarea
                rows={2}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.systemPrompt ?? "")}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.variableName")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.variableName ?? "openai_reply")}
                onChange={(e) => patch({ variableName: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.openaiModel")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder="gpt-4o-mini"
                value={String(data.model ?? "")}
                onChange={(e) => patch({ model: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
              <input
                type="checkbox"
                checked={data.sendToUser === true}
                onChange={(e) => patch({ sendToUser: e.target.checked })}
              />
              {t("chatbotPage.openaiSendToUser")}
            </label>
            <p className="text-[10px] text-ink-400">{t("chatbotPage.openaiHint")}</p>
          </>
        )}

        {node.type === "condition" && (
          <>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.conditionField")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                placeholder="contact.name"
                value={String(data.field ?? "")}
                onChange={(e) => patch({ field: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.conditionOp")}</span>
              <select
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.operator ?? "eq")}
                onChange={(e) => patch({ operator: e.target.value })}
              >
                <option value="eq">=</option>
                <option value="neq">≠</option>
                <option value="contains">contains</option>
                <option value="empty">empty</option>
                <option value="not_empty">not empty</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.conditionValue")}</span>
              <input
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
                value={String(data.value ?? "")}
                onChange={(e) => patch({ value: e.target.value })}
              />
            </label>
          </>
        )}

        {node.type === "set_variable" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.variableValue")}</span>
            <input
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.value ?? "")}
              onChange={(e) => patch({ value: e.target.value })}
            />
          </label>
        )}

        {node.type === "wait" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.waitSeconds")}</span>
            <input
              type="number"
              min={1}
              max={300}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.seconds ?? "")}
              onChange={(e) => patch({ seconds: Number(e.target.value) })}
            />
          </label>
        )}

        {node.type === "jump" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.jumpTarget")}</span>
            <select
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.targetNodeId ?? "")}
              onChange={(e) => patch({ targetNodeId: e.target.value })}
            >
              <option value="">—</option>
              {allNodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.type} ({n.id.slice(0, 8)})
                  </option>
                ))}
            </select>
          </label>
        )}

        {node.type === "handoff" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold text-ink-600 dark:text-ink-400">{t("chatbotPage.handoffMessage")}</span>
            <textarea
              rows={3}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
              value={String(data.message ?? "")}
              onChange={(e) => patch({ message: e.target.value })}
            />
          </label>
        )}

        <p className="text-[10px] text-ink-400">{t("chatbotPage.flowFootnote")}</p>
      </div>

      {canDelete ? (
        <div className="border-t border-ink-100 p-3 dark:border-ink-800">
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30"
          >
            <Trash2 className="h-4 w-4" />
            {t("chatbotPage.deleteBlock")}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
