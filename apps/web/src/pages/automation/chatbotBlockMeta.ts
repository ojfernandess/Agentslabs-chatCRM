import type { LucideIcon } from "lucide-react";
import {
  CirclePlay,
  Flag,
  GitBranch,
  Globe,
  Image,
  MessageSquare,
  MousePointerClick,
  Tag,
  Timer,
  Type,
  UserRound,
  Variable,
  Webhook,
  Zap,
} from "lucide-react";

export type ChatbotBlockCategory = "bubbles" | "inputs" | "logic" | "integrations" | "events";

export interface ChatbotBlockMeta {
  type: string;
  category: ChatbotBlockCategory;
  icon: LucideIcon;
  color: string;
  bgLight: string;
  borderColor: string;
  labelKey: string;
  descriptionKey: string;
}

export const CHATBOT_CATEGORY_META: Record<
  ChatbotBlockCategory,
  { labelKey: string; accent: string; bg: string }
> = {
  events: { labelKey: "chatbotPage.catEvents", accent: "#64748b", bg: "bg-slate-100 dark:bg-slate-800/60" },
  bubbles: { labelKey: "chatbotPage.catBubbles", accent: "#2563eb", bg: "bg-blue-50 dark:bg-blue-950/30" },
  inputs: { labelKey: "chatbotPage.catInputs", accent: "#ea580c", bg: "bg-orange-50 dark:bg-orange-950/30" },
  logic: { labelKey: "chatbotPage.catLogic", accent: "#7c3aed", bg: "bg-violet-50 dark:bg-violet-950/30" },
  integrations: {
    labelKey: "chatbotPage.catIntegrations",
    accent: "#059669",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
  },
};

export const CHATBOT_BLOCK_META: Record<string, ChatbotBlockMeta> = {
  start: {
    type: "start",
    category: "events",
    icon: CirclePlay,
    color: "#64748b",
    bgLight: "bg-slate-50 dark:bg-slate-900/80",
    borderColor: "border-slate-300 dark:border-slate-600",
    labelKey: "chatbotPage.blockStart",
    descriptionKey: "chatbotPage.blockStartDesc",
  },
  end: {
    type: "end",
    category: "events",
    icon: Flag,
    color: "#64748b",
    bgLight: "bg-slate-50 dark:bg-slate-900/80",
    borderColor: "border-slate-300 dark:border-slate-600",
    labelKey: "chatbotPage.blockEnd",
    descriptionKey: "chatbotPage.blockEndDesc",
  },
  text: {
    type: "text",
    category: "bubbles",
    icon: MessageSquare,
    color: "#2563eb",
    bgLight: "bg-blue-50/90 dark:bg-blue-950/40",
    borderColor: "border-blue-200 dark:border-blue-800",
    labelKey: "chatbotPage.blockText",
    descriptionKey: "chatbotPage.blockTextDesc",
  },
  image: {
    type: "image",
    category: "bubbles",
    icon: Image,
    color: "#2563eb",
    bgLight: "bg-blue-50/90 dark:bg-blue-950/40",
    borderColor: "border-blue-200 dark:border-blue-800",
    labelKey: "chatbotPage.blockImage",
    descriptionKey: "chatbotPage.blockImageDesc",
  },
  text_input: {
    type: "text_input",
    category: "inputs",
    icon: Type,
    color: "#ea580c",
    bgLight: "bg-orange-50/90 dark:bg-orange-950/40",
    borderColor: "border-orange-200 dark:border-orange-800",
    labelKey: "chatbotPage.blockTextInput",
    descriptionKey: "chatbotPage.blockTextInputDesc",
  },
  choice_input: {
    type: "choice_input",
    category: "inputs",
    icon: MousePointerClick,
    color: "#ea580c",
    bgLight: "bg-orange-50/90 dark:bg-orange-950/40",
    borderColor: "border-orange-200 dark:border-orange-800",
    labelKey: "chatbotPage.blockChoiceInput",
    descriptionKey: "chatbotPage.blockChoiceInputDesc",
  },
  condition: {
    type: "condition",
    category: "logic",
    icon: GitBranch,
    color: "#7c3aed",
    bgLight: "bg-violet-50/90 dark:bg-violet-950/40",
    borderColor: "border-violet-200 dark:border-violet-800",
    labelKey: "chatbotPage.blockCondition",
    descriptionKey: "chatbotPage.blockConditionDesc",
  },
  set_variable: {
    type: "set_variable",
    category: "logic",
    icon: Variable,
    color: "#7c3aed",
    bgLight: "bg-violet-50/90 dark:bg-violet-950/40",
    borderColor: "border-violet-200 dark:border-violet-800",
    labelKey: "chatbotPage.blockSetVariable",
    descriptionKey: "chatbotPage.blockSetVariableDesc",
  },
  wait: {
    type: "wait",
    category: "logic",
    icon: Timer,
    color: "#7c3aed",
    bgLight: "bg-violet-50/90 dark:bg-violet-950/40",
    borderColor: "border-violet-200 dark:border-violet-800",
    labelKey: "chatbotPage.blockWait",
    descriptionKey: "chatbotPage.blockWaitDesc",
  },
  jump: {
    type: "jump",
    category: "logic",
    icon: Zap,
    color: "#7c3aed",
    bgLight: "bg-violet-50/90 dark:bg-violet-950/40",
    borderColor: "border-violet-200 dark:border-violet-800",
    labelKey: "chatbotPage.blockJump",
    descriptionKey: "chatbotPage.blockJumpDesc",
  },
  webhook: {
    type: "webhook",
    category: "integrations",
    icon: Webhook,
    color: "#059669",
    bgLight: "bg-emerald-50/90 dark:bg-emerald-950/40",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    labelKey: "chatbotPage.blockWebhook",
    descriptionKey: "chatbotPage.blockWebhookDesc",
  },
  add_tag: {
    type: "add_tag",
    category: "integrations",
    icon: Tag,
    color: "#059669",
    bgLight: "bg-emerald-50/90 dark:bg-emerald-950/40",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    labelKey: "chatbotPage.blockAddTag",
    descriptionKey: "chatbotPage.blockAddTagDesc",
  },
  handoff: {
    type: "handoff",
    category: "integrations",
    icon: UserRound,
    color: "#059669",
    bgLight: "bg-emerald-50/90 dark:bg-emerald-950/40",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    labelKey: "chatbotPage.blockHandoff",
    descriptionKey: "chatbotPage.blockHandoffDesc",
  },
};

export const PALETTE_BY_CATEGORY: ChatbotBlockCategory[] = [
  "bubbles",
  "inputs",
  "logic",
  "integrations",
];

export function getBlockMeta(type: string): ChatbotBlockMeta {
  return (
    CHATBOT_BLOCK_META[type] ?? {
      type,
      category: "logic",
      icon: Globe,
      color: "#64748b",
      bgLight: "bg-ink-50 dark:bg-ink-900",
      borderColor: "border-ink-200",
      labelKey: type,
      descriptionKey: "chatbotPage.blockGenericDesc",
    }
  );
}

export function blockPreviewText(type: string, data?: Record<string, unknown>): string {
  if (type === "text") return String(data?.content ?? "").slice(0, 80);
  if (type === "text_input" || type === "choice_input") return String(data?.prompt ?? data?.content ?? "").slice(0, 80);
  if (type === "image" || type === "webhook") return String(data?.url ?? "").slice(0, 60);
  if (type === "condition") return `${data?.field ?? "?"} ${data?.operator ?? "="} ${data?.value ?? ""}`;
  if (type === "set_variable") return `${data?.name ?? data?.variableName ?? ""} = ${data?.value ?? ""}`;
  if (type === "wait") return `${data?.seconds ?? 0}s`;
  return "";
}
