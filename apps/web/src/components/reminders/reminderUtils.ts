import { format, isPast, isToday, isTomorrow, isThisWeek, startOfDay, endOfDay, addDays } from "date-fns";
import type { Locale } from "date-fns";

export type ReminderPriority = "low" | "medium" | "high" | "urgent";
export type ReminderLane = "overdue" | "today" | "upcoming" | "done";

export type ReminderStatus = "TODO" | "DOING" | "DONE";
export type ReminderPriorityDb = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export function statusFromLegacy(completed: boolean, status?: string | null): ReminderStatus {
  if (status === "TODO" || status === "DOING" || status === "DONE") return status;
  return completed ? "DONE" : "TODO";
}

export function priorityFromLegacy(completed: boolean, dueAt: Date, priority?: string | null): ReminderPriorityDb {
  if (priority === "LOW" || priority === "MEDIUM" || priority === "HIGH" || priority === "URGENT") return priority;
  if (completed) return "LOW";
  if (isPast(dueAt) && !isToday(dueAt)) return "URGENT";
  if (isToday(dueAt)) return "HIGH";
  if (isTomorrow(dueAt)) return "MEDIUM";
  return "LOW";
}

export function priorityLabelDb(p: ReminderPriorityDb): string {
  if (p === "URGENT") return "Urgente";
  if (p === "HIGH") return "Alta";
  if (p === "MEDIUM") return "Média";
  return "Baixa";
}

export function ymdLocal(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function startOfDayLocal(d: Date): Date {
  return startOfDay(d);
}

export function endOfDayLocal(d: Date): Date {
  return endOfDay(d);
}

export function computeReminderLane(dueAt: Date, completed: boolean): ReminderLane {
  if (completed) return "done";
  if (isPast(dueAt) && !isToday(dueAt)) return "overdue";
  if (isToday(dueAt)) return "today";
  return "upcoming";
}

export function computePriority(dueAt: Date, completed: boolean): ReminderPriority {
  if (completed) return "low";
  if (isPast(dueAt) && !isToday(dueAt)) return "urgent";
  if (isToday(dueAt)) return "high";
  if (isTomorrow(dueAt)) return "medium";
  return "low";
}

export function computeAiScore(dueAt: Date, completed: boolean): number {
  if (completed) return 5;
  const now = Date.now();
  const dt = dueAt.getTime() - now;
  const hours = dt / (1000 * 60 * 60);
  if (hours <= -24) return 92;
  if (hours < 0) return 86;
  if (hours <= 6) return 78;
  if (hours <= 24) return 66;
  if (hours <= 72) return 52;
  return 38;
}

export function aiInsightLines(dueAt: Date, completed: boolean, locale: Locale): string[] {
  if (completed) return ["✓ Concluído", format(dueAt, "PPp", { locale })];
  const lines: string[] = [];
  if (isPast(dueAt)) lines.push("✓ Atrasado", "✓ Recomendado agir hoje");
  else if (isToday(dueAt)) lines.push("✓ Hoje é o melhor momento", "✓ Alta prioridade");
  else if (isThisWeek(dueAt)) lines.push("✓ Programado para esta semana", "✓ Manter no radar");
  else lines.push("✓ Programado para o futuro", "✓ Pode ser antecipado se necessário");
  lines.push(format(dueAt, "PPp", { locale }));
  return lines;
}

export function formatShortDue(dueAt: Date, locale: Locale): string {
  return format(dueAt, "PPp", { locale });
}

export function isWithinDateRange(dueAt: Date, start?: Date, end?: Date): boolean {
  if (start && dueAt < startOfDayLocal(start)) return false;
  if (end && dueAt > endOfDayLocal(end)) return false;
  return true;
}

export function next7Days(): Date[] {
  const base = startOfDayLocal(new Date());
  return Array.from({ length: 7 }, (_, i) => addDays(base, i));
}

