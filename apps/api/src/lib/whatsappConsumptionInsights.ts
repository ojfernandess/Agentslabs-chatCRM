import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { getResendEmailConfigFromDb } from "./resendEmailSettings.js";
import { sendWhatsappBillableAlertEmail } from "./sendWhatsappBillableAlertEmail.js";
import type { CategoryConsumptionRow } from "./whatsappOrgPolicy.js";

export const WHATSAPP_CONSUMPTION_DASHBOARD_FLAG = "whatsapp_consumption_dashboard" as const;

export type WhatsappConsumptionVisibility = "organization" | "super_admin_only";

export type WhatsappConsumptionInsightsOrgConfig = {
  visibility: WhatsappConsumptionVisibility;
  alertAdminOnBillable: boolean;
  lastBillableAlertMonth: string | null;
};

const PLATFORM_SETTING_KEY = "whatsapp_consumption_insights_by_org";

const DEFAULT_CONFIG: WhatsappConsumptionInsightsOrgConfig = {
  visibility: "organization",
  alertAdminOnBillable: false,
  lastBillableAlertMonth: null,
};

type ConfigMap = Record<string, WhatsappConsumptionInsightsOrgConfig>;

function normalizeOrgConfig(raw: unknown): WhatsappConsumptionInsightsOrgConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const o = raw as Record<string, unknown>;
  const visibility =
    o.visibility === "super_admin_only" ? "super_admin_only" : "organization";
  return {
    visibility,
    alertAdminOnBillable: o.alertAdminOnBillable === true,
    lastBillableAlertMonth:
      typeof o.lastBillableAlertMonth === "string" ? o.lastBillableAlertMonth : null,
  };
}

async function loadConfigMap(): Promise<ConfigMap> {
  const row = await prisma.platformSetting.findUnique({
    where: { key: PLATFORM_SETTING_KEY },
    select: { value: true },
  });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return {};
  }
  const out: ConfigMap = {};
  for (const [orgId, cfg] of Object.entries(row.value as Record<string, unknown>)) {
    out[orgId] = normalizeOrgConfig(cfg);
  }
  return out;
}

async function saveConfigMap(map: ConfigMap): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: PLATFORM_SETTING_KEY },
    create: { key: PLATFORM_SETTING_KEY, value: map },
    update: { value: map },
  });
}

export async function getWhatsappConsumptionInsightsConfig(
  organizationId: string,
): Promise<WhatsappConsumptionInsightsOrgConfig> {
  const map = await loadConfigMap();
  return map[organizationId] ?? { ...DEFAULT_CONFIG };
}

export async function setWhatsappConsumptionInsightsConfig(
  organizationId: string,
  patch: Partial<
    Pick<WhatsappConsumptionInsightsOrgConfig, "visibility" | "alertAdminOnBillable">
  >,
): Promise<WhatsappConsumptionInsightsOrgConfig> {
  const map = await loadConfigMap();
  const current = map[organizationId] ?? { ...DEFAULT_CONFIG };
  const next: WhatsappConsumptionInsightsOrgConfig = {
    ...current,
    ...(patch.visibility != null ? { visibility: patch.visibility } : {}),
    ...(patch.alertAdminOnBillable != null
      ? { alertAdminOnBillable: patch.alertAdminOnBillable }
      : {}),
  };
  if (next.visibility === "organization") {
    next.alertAdminOnBillable = false;
  }
  map[organizationId] = next;
  await saveConfigMap(map);
  return next;
}

export async function isWhatsappConsumptionDashboardEnabled(organizationId: string): Promise<boolean> {
  return isOrganizationFeatureEnabled(organizationId, WHATSAPP_CONSUMPTION_DASHBOARD_FLAG);
}

export async function canTenantAccessWhatsappConsumptionDashboard(
  organizationId: string,
): Promise<boolean> {
  if (!(await isWhatsappConsumptionDashboardEnabled(organizationId))) return false;
  const cfg = await getWhatsappConsumptionInsightsConfig(organizationId);
  return cfg.visibility === "organization";
}

export async function canSuperAdminAccessWhatsappConsumptionDashboard(
  organizationId: string,
): Promise<boolean> {
  return isWhatsappConsumptionDashboardEnabled(organizationId);
}

function calendarMonthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function totalBillable(rows: CategoryConsumptionRow[]): number {
  return rows.reduce((sum, r) => sum + (r.billable != null && r.billable > 0 ? r.billable : 0), 0);
}

async function resolveOrgAdminEmails(organizationId: string): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: {
      OR: [
        { organizationId, role: "ADMIN" },
        { memberships: { some: { organizationId, role: "ADMIN" } } },
      ],
    },
    select: { email: true },
  });
  return [...new Set(admins.map((a) => a.email.trim().toLowerCase()).filter((e) => e.includes("@")))];
}

/** Uma vez por mês, se configurado — chamado após agregar consumo (não bloqueia a resposta). */
export async function maybeNotifyWhatsappBillableStarted(
  organizationId: string,
  rows: CategoryConsumptionRow[],
): Promise<void> {
  const enabled = await isWhatsappConsumptionDashboardEnabled(organizationId);
  if (!enabled) return;

  const cfg = await getWhatsappConsumptionInsightsConfig(organizationId);
  if (cfg.visibility !== "super_admin_only" || !cfg.alertAdminOnBillable) return;

  const billable = totalBillable(rows);
  if (billable <= 0) return;

  const monthKey = calendarMonthKey(new Date());
  if (cfg.lastBillableAlertMonth === monthKey) return;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!org) return;

  const recipients = await resolveOrgAdminEmails(organizationId);
  const cfgResend = await getResendEmailConfigFromDb();
  if (!cfgResend || recipients.length === 0) return;

  let sent = false;
  for (const toEmail of recipients) {
    const result = await sendWhatsappBillableAlertEmail(cfgResend, toEmail, {
      organizationName: org.name,
      billableCount: billable,
      monthKey,
    });
    if (result.ok) sent = true;
  }
  if (!sent) return;

  const map = await loadConfigMap();
  const current = map[organizationId] ?? { ...DEFAULT_CONFIG };
  map[organizationId] = { ...current, lastBillableAlertMonth: monthKey };
  await saveConfigMap(map);
}
