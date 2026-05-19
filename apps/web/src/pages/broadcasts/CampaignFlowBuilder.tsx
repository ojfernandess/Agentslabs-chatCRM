import { useCallback, useState } from "react";
import clsx from "clsx";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { FLOW_BLOCK_KEYS } from "./campaignTypes";

export interface FlowNode {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const BLOCK_TYPES = [
  "start",
  "send_message",
  "wait",
  "condition",
  "ai_reply",
  "check_tag",
  "webhook",
  "email",
  "end",
] as const;

const BLOCK_LABEL: Record<string, string> = {
  start: "broadcastPage.flowStart",
  send_message: "broadcastPage.flowSendMessage",
  wait: "broadcastPage.flowWait",
  condition: "broadcastPage.flowCondition",
  ai_reply: "broadcastPage.flowAiReply",
  check_tag: "broadcastPage.flowCheckTag",
  webhook: "broadcastPage.flowWebhook",
  email: "broadcastPage.flowEmail",
  end: "broadcastPage.flowEnd",
};

function defaultFlow(): FlowDefinition {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 20, y: 20 }, data: {} },
      { id: "send", type: "send_message", position: { x: 20, y: 100 }, data: {} },
      { id: "end", type: "end", position: { x: 20, y: 180 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "send" },
      { id: "e2", source: "send", target: "end" },
    ],
  };
}

interface Props {
  value: FlowDefinition | null;
  onChange: (flow: FlowDefinition) => void;
}

export function CampaignFlowBuilder({ value, onChange }: Props) {
  const { t } = useI18n();
  const [flow, setFlow] = useState<FlowDefinition>(value ?? defaultFlow());
  const [dragId, setDragId] = useState<string | null>(null);

  const sync = useCallback(
    (next: FlowDefinition) => {
      setFlow(next);
      onChange(next);
    },
    [onChange],
  );

  const addNode = (type: string) => {
    const id = `${type}_${Date.now()}`;
    const last = flow.nodes[flow.nodes.length - 1];
    const y = (last?.position.y ?? 0) + 80;
    const node: FlowNode = { id, type, position: { x: 20, y }, data: {} };
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

  const onDragStart = (id: string) => setDragId(id);
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
    const edges: FlowEdge[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      edges.push({ id: `e_${ordered[i].id}_${ordered[i + 1].id}`, source: ordered[i].id, target: ordered[i + 1].id });
    }
    sync({ nodes: ordered, edges });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500 dark:text-ink-400">{t("broadcastPage.flowBuilderDragHint")}</p>
      <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-3 dark:border-white/10 dark:bg-white/5">
        {flow.nodes.map((node) => (
          <div
            key={node.id}
            draggable={node.type !== "start" && node.type !== "end"}
            onDragStart={() => onDragStart(node.id)}
            onDragOver={(e) => onDragOver(e, node.id)}
            onDragEnd={() => setDragId(null)}
            className={clsx(
              "mb-2 flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs shadow-sm dark:bg-[#111C2B]",
              dragId === node.id ? "border-brand-400" : "border-ink-200 dark:border-white/10",
            )}
          >
            <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-ink-400" />
            <span className="flex-1 font-semibold text-ink-800 dark:text-ink-100">
              {t(BLOCK_LABEL[node.type] ?? "broadcastPage.flowSendMessage")}
            </span>
            {node.type === "wait" ? (
              <input
                type="number"
                min={1}
                max={1440}
                className="w-14 rounded border border-ink-200 px-1 py-0.5 text-[10px] dark:border-white/10 dark:bg-white/5"
                placeholder="min"
                value={String(node.data?.minutes ?? "")}
                onChange={(e) => {
                  const nodes = flow.nodes.map((n) =>
                    n.id === node.id ? { ...n, data: { ...n.data, minutes: Number(e.target.value) } } : n,
                  );
                  sync({ ...flow, nodes });
                }}
              />
            ) : null}
            {node.type !== "start" && node.type !== "end" ? (
              <button type="button" onClick={() => removeNode(node.id)} className="text-ink-400 hover:text-rose-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {BLOCK_TYPES.filter((x) => x !== "start" && x !== "end").map((type) => (
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
      <p className="text-[10px] text-ink-500">{t("broadcastPage.flowBuilderFootnote")}</p>
    </div>
  );
}
