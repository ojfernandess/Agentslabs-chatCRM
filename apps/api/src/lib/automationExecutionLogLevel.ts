/** Alinhado ao enum Prisma `AutomationLogLevel` — ficheiro sem dependências para testes. */
export const AUTOMATION_LOG_LEVEL_ORDER = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
} as const;

export type AutomationLogLevelName = keyof typeof AUTOMATION_LOG_LEVEL_ORDER;

export function automationLogSeverityRank(level: AutomationLogLevelName): number {
  return AUTOMATION_LOG_LEVEL_ORDER[level];
}
