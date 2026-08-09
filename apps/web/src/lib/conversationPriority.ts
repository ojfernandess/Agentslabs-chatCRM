import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowDown, Minus, Zap } from "lucide-react";

export type ConversationPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type ConversationPriorityValue = ConversationPriority | null | undefined;

export const CONVERSATION_PRIORITIES: ConversationPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

export function isConversationPriority(v: unknown): v is ConversationPriority {
  return v === "LOW" || v === "MEDIUM" || v === "HIGH" || v === "URGENT";
}

export function priorityLabelKey(p: ConversationPriority | "NONE"): string {
  if (p === "NONE") return "conversations.contextMenu.priorityNone";
  return `conversations.contextMenu.priority${p}` as const;
}

export function priorityIcon(p: ConversationPriority): LucideIcon {
  if (p === "URGENT") return Zap;
  if (p === "HIGH") return AlertTriangle;
  if (p === "MEDIUM") return Minus;
  return ArrowDown;
}

/** Classes do badge (pill) por prioridade. */
export function priorityBadgeClass(p: ConversationPriority): string {
  if (p === "URGENT") {
    return "bg-red-600 text-white shadow-sm shadow-red-500/30 ring-1 ring-red-400/50 dark:bg-red-600 dark:ring-red-400/40";
  }
  if (p === "HIGH") {
    return "bg-orange-500 text-white shadow-sm dark:bg-orange-600";
  }
  if (p === "MEDIUM") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/55 dark:text-amber-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-ink-800 dark:text-ink-300";
}

/** Destaque do cartão na lista de conversas. */
export function priorityListCardClass(p: ConversationPriorityValue): string {
  if (p === "URGENT") {
    return "border-red-400/90 bg-red-50/40 shadow-md shadow-red-500/10 ring-2 ring-red-400/35 dark:border-red-500/70 dark:bg-red-950/30 dark:shadow-red-900/20 dark:ring-red-500/40";
  }
  if (p === "HIGH") {
    return "border-orange-300/90 bg-orange-50/30 ring-1 ring-orange-300/40 dark:border-orange-500/50 dark:bg-orange-950/20 dark:ring-orange-500/30";
  }
  if (p === "MEDIUM") {
    return "border-amber-200/80 dark:border-amber-600/35";
  }
  if (p === "LOW") {
    return "border-slate-200/90 dark:border-ink-700";
  }
  return "";
}
