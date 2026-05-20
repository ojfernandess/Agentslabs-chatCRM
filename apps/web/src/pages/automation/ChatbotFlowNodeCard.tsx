import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { useI18n } from "@/i18n/I18nProvider";
import { blockPreviewText, getBlockMeta } from "./chatbotBlockMeta";

export type ChatbotFlowNodeData = {
  blockType: string;
  blockData?: Record<string, unknown>;
};

export type ChatbotRfNode = Node<ChatbotFlowNodeData, "chatbotBlock">;

function ChatbotFlowNodeCardComponent({ data, selected }: NodeProps<ChatbotRfNode>) {
  const { t } = useI18n();
  const meta = getBlockMeta(data.blockType);
  const Icon = meta.icon;
  const preview = blockPreviewText(data.blockType, data.blockData);
  const isCondition = data.blockType === "condition";
  const isAbTest = data.blockType === "ab_test";
  const abVariants = (() => {
    const raw = data.blockData?.variants;
    if (!Array.isArray(raw)) return [{ id: "a" }, { id: "b" }];
    const list = raw
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x, i) => ({
        id: typeof x.id === "string" && x.id.trim() ? x.id.trim() : String.fromCharCode(97 + i),
      }));
    return list.length ? list : [{ id: "a" }, { id: "b" }];
  })();
  const isStart = data.blockType === "start";
  const isEnd = data.blockType === "end";

  return (
    <div
      className={clsx(
        "w-[280px] rounded-2xl border-2 bg-white shadow-md transition-shadow dark:bg-[#1a1f2e]",
        meta.borderColor,
        selected && "ring-2 ring-[#ff6b2c] ring-offset-2 ring-offset-[#eef0f4] dark:ring-offset-[#12141c]",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: meta.color }}
    >
      {!isStart ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-white !bg-[#94a3b8] dark:!border-[#1a1f2e]"
        />
      ) : null}

      <div className={clsx("rounded-t-2xl px-3 py-2", meta.bgLight)}>
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: meta.color }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-ink-900 dark:text-ink-50">{t(meta.labelKey)}</p>
            <p className="truncate text-[10px] text-ink-500 dark:text-ink-400">{t(meta.descriptionKey)}</p>
          </div>
        </div>
      </div>

      {preview ? (
        <div className="border-t border-ink-100 px-3 py-2 dark:border-white/5">
          <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-600 dark:text-ink-300">{preview}</p>
        </div>
      ) : null}

      {!isEnd ? (
        isCondition ? (
          <div className="relative flex justify-between px-6 pb-2 pt-1">
            <span className="text-[9px] font-semibold uppercase text-emerald-600">{t("chatbotPage.branchYes")}</span>
            <span className="text-[9px] font-semibold uppercase text-rose-500">{t("chatbotPage.branchNo")}</span>
            <Handle
              type="source"
              id="yes"
              position={Position.Bottom}
              className="!left-[28%] !h-3 !w-3 !border-2 !border-white !bg-emerald-500"
            />
            <Handle
              type="source"
              id="no"
              position={Position.Bottom}
              className="!left-[72%] !h-3 !w-3 !border-2 !border-white !bg-rose-500"
            />
          </div>
        ) : isAbTest ? (
          <div className="relative px-4 pb-2 pt-1">
            <div className="flex justify-between gap-1">
              {abVariants.map((v) => (
                <span key={v.id} className="text-[9px] font-semibold uppercase text-violet-600">
                  {v.id}
                </span>
              ))}
            </div>
            {abVariants.map((v, i) => {
              const pct =
                abVariants.length > 1 ? ((i + 1) / (abVariants.length + 1)) * 100 : 50;
              return (
                <Handle
                  key={v.id}
                  type="source"
                  id={v.id}
                  position={Position.Bottom}
                  className="!h-3 !w-3 !border-2 !border-white !bg-violet-500"
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        ) : (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!h-3 !w-3 !border-2 !border-white !bg-[#ff6b2c]"
          />
        )
      ) : null}
    </div>
  );
}

export const ChatbotFlowNodeCard = memo(ChatbotFlowNodeCardComponent);
