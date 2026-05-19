import { useCallback, useState } from "react";
import clsx from "clsx";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { CHATBOT_BLOCK_TYPES, type ChatbotFlowDefinition, type ChatbotFlowNode } from "./chatbotFlowTypes";

const BLOCK_LABEL: Record<string, string> = {
  start: "chatbotPage.blockStart",
  text: "chatbotPage.blockText",
  image: "chatbotPage.blockImage",
  text_input: "chatbotPage.blockTextInput",
  choice_input: "chatbotPage.blockChoiceInput",
  condition: "chatbotPage.blockCondition",
  set_variable: "chatbotPage.blockSetVariable",
  webhook: "chatbotPage.blockWebhook",
  add_tag: "chatbotPage.blockAddTag",
  handoff: "chatbotPage.blockHandoff",
  wait: "chatbotPage.blockWait",
  jump: "chatbotPage.blockJump",
  end: "chatbotPage.blockEnd",
};

interface Props {
  value: ChatbotFlowDefinition;
  onChange: (flow: ChatbotFlowDefinition) => void;
}

export function ChatbotFlowBuilder({ value, onChange }: Props) {
  const { t } = useI18n();
  const [flow, setFlow] = useState(value);
  const [dragId, setDragId] = useState<string | null>(null);

  const sync = useCallback(
    (next: ChatbotFlowDefinition) => {
      setFlow(next);
      onChange(next);
    },
    [onChange],
  );

  const addNode = (type: string) => {
    const id = `${type}_${Date.now()}`;
    const last = flow.nodes[flow.nodes.length - 1];
    const y = (last?.position.y ?? 0) + 80;
    const node: ChatbotFlowNode = { id, type, position: { x: 20, y }, data: {} };
    const nodes = [...flow.nodes, node];
    const edges = last
      ? [...flow.edges, { id: `e_${id}`, source: last.id, target: id }]
      : flow.edges;
    sync({ nodes, edges });
  };

  const removeNode = (id: string) => {
    if (id === "start" || id === "end") return;
    sync({
      nodes: flow.nodes.filter((n) => n.id !== id),
      edges: flow.edges.filter((e) => e.source !== id && e.target !== id),
    });
  };

  const updateNodeData = (id: string, patch: Record<string, unknown>) => {
    sync({
      ...flow,
      nodes: flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    });
  };

  const onDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;
    const from = flow.nodes.findIndex((n) => n.id === dragId);
    const to = flow.nodes.findIndex((n) => n.id === overId);
    if (from < 0 || to < 0) return;
    const nodes = [...flow.nodes];
    const [item] = nodes.splice(from, 1);
    nodes.splice(to, 0, item);
    const ordered = nodes.map((n, i) => ({ ...n, position: { x: 20, y: 20 + i * 80 } }));
    const edges = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      edges.push({ id: `e_${ordered[i].id}_${ordered[i + 1].id}`, source: ordered[i].id, target: ordered[i + 1].id });
    }
    sync({ nodes: ordered, edges });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500 dark:text-ink-400">{t("chatbotPage.flowDragHint")}</p>
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-3 dark:border-white/10 dark:bg-white/5">
        {flow.nodes.map((node) => (
          <div
            key={node.id}
            draggable={node.type !== "start" && node.type !== "end"}
            onDragStart={() => setDragId(node.id)}
            onDragOver={(e) => onDragOver(e, node.id)}
            onDragEnd={() => setDragId(null)}
            className={clsx(
              "mb-2 flex flex-col gap-2 rounded-lg border bg-white px-3 py-2 text-xs shadow-sm dark:bg-[#111C2B]",
              dragId === node.id ? "border-brand-400" : "border-ink-200 dark:border-white/10",
            )}
          >
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-ink-400" />
              <span className="flex-1 font-semibold text-ink-800 dark:text-ink-100">
                {t(BLOCK_LABEL[node.type] ?? node.type)}
              </span>
              {node.type !== "start" && node.type !== "end" ? (
                <button type="button" onClick={() => removeNode(node.id)} className="text-ink-400 hover:text-rose-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {node.type === "text" || node.type === "text_input" || node.type === "choice_input" ? (
              <textarea
                rows={2}
                className="w-full rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-white/10 dark:bg-white/5"
                placeholder={node.type === "text" ? t("chatbotPage.contentPlaceholder") : t("chatbotPage.promptPlaceholder")}
                value={String(node.data?.content ?? node.data?.prompt ?? "")}
                onChange={(e) =>
                  updateNodeData(node.id, node.type === "text" ? { content: e.target.value } : { prompt: e.target.value })
                }
              />
            ) : null}
            {node.type === "text_input" || node.type === "choice_input" || node.type === "set_variable" ? (
              <input
                className="w-full rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-white/10 dark:bg-white/5"
                placeholder={t("chatbotPage.variableName")}
                value={String(node.data?.variableName ?? node.data?.name ?? "")}
                onChange={(e) =>
                  updateNodeData(
                    node.id,
                    node.type === "set_variable" ? { name: e.target.value } : { variableName: e.target.value },
                  )
                }
              />
            ) : null}
            {node.type === "image" || node.type === "webhook" ? (
              <input
                className="w-full rounded border border-ink-200 px-2 py-1 text-[11px] dark:border-white/10 dark:bg-white/5"
                placeholder="https://..."
                value={String(node.data?.url ?? "")}
                onChange={(e) => updateNodeData(node.id, { url: e.target.value })}
              />
            ) : null}
            {node.type === "condition" ? (
              <div className="grid grid-cols-3 gap-1">
                <input
                  className="rounded border border-ink-200 px-1 py-0.5 text-[10px] dark:border-white/10"
                  placeholder="field"
                  value={String(node.data?.field ?? "")}
                  onChange={(e) => updateNodeData(node.id, { field: e.target.value })}
                />
                <select
                  className="rounded border border-ink-200 px-1 py-0.5 text-[10px] dark:border-white/10"
                  value={String(node.data?.operator ?? "eq")}
                  onChange={(e) => updateNodeData(node.id, { operator: e.target.value })}
                >
                  <option value="eq">=</option>
                  <option value="contains">contains</option>
                  <option value="empty">empty</option>
                </select>
                <input
                  className="rounded border border-ink-200 px-1 py-0.5 text-[10px] dark:border-white/10"
                  placeholder="value"
                  value={String(node.data?.value ?? "")}
                  onChange={(e) => updateNodeData(node.id, { value: e.target.value })}
                />
              </div>
            ) : null}
            {node.type === "wait" ? (
              <input
                type="number"
                min={1}
                max={300}
                className="w-20 rounded border border-ink-200 px-1 py-0.5 text-[10px] dark:border-white/10"
                placeholder="sec"
                value={String(node.data?.seconds ?? "")}
                onChange={(e) => updateNodeData(node.id, { seconds: Number(e.target.value) })}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {CHATBOT_BLOCK_TYPES.filter((x) => x !== "start" && x !== "end").map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addNode(type)}
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-[10px] font-medium hover:bg-ink-50 dark:border-white/10 dark:hover:bg-white/5"
          >
            <Plus className="h-3 w-3" />
            {t(BLOCK_LABEL[type] ?? type)}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-ink-500">{t("chatbotPage.flowFootnote")}</p>
    </div>
  );
}
