import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { reconcileWhatsappLedgerBillabilityForRange } from "./messageBillingLedger.js";
import { getResendEmailConfigFromDb } from "./resendEmailSettings.js";
import {
  sendWhatsappBillableAlertEmail,
  sendWhatsappQuotaAlertEmail,
} from "./sendWhatsappBillableAlertEmail.js";

export const WHATSAPP_CONSUMPTION_DASHBOARD_FLAG = "whatsapp_consumption_dashboard" as const;

export type WhatsappConsumptionVisibility = "organization" | "super_admin_only";

export type WhatsappBillableAlertAdmin = {
  id: string;
  name: string;
  email: string;
};

export type WhatsappConsumptionInsightsOrgConfig = {
  visibility: WhatsappConsumptionVisibility;
  alertAdminOnBillable: boolean;
  /** `null` = todos os administradores (comportamento anterior). Lista vazia = ninguém. */
  billableAlertRecipientUserIds: string[] | null;
  lastBillableAlertMonth: string | null;
  lastQuotaAlert80Month: string | null;
  lastQuotaAlert100Month: string | null;
};

const PLATFORM_SETTING_KEY = "whatsapp_consumption_insights_by_org";

const DEFAULT_CONFIG: WhatsappConsumptionInsightsOrgConfig = {
  visibility: "organization",
  alertAdminOnBillable: false,
  billableAlertRecipientUserIds: null,
  lastBillableAlertMonth: null,
  lastQuotaAlert80Month: null,
  lastQuotaAlert100Month: null,
};

type ConfigMap = Record<string, WhatsappConsumptionInsightsOrgConfig>;

function normalizeOrgConfig(raw: unknown): WhatsappConsumptionInsightsOrgConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
  const o = raw as Record<string, unknown>;
  const visibility =
    o.visibility === "super_admin_only" ? "super_admin_only" : "organization";
  const rawIds = o.billableAlertRecipientUserIds;
  const billableAlertRecipientUserIds = Array.isArray(rawIds)
    ? [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : null;
  return {
    visibility,
    alertAdminOnBillable: o.alertAdminOnBillable === true,
    billableAlertRecipientUserIds,
    lastBillableAlertMonth:
      typeof o.lastBillableAlertMonth === "string" ? o.lastBillableAlertMonth : null,
    lastQuotaAlert80Month:
      typeof o.lastQuotaAlert80Month === "string" ? o.lastQuotaAlert80Month : null,
    lastQuotaAlert100Month:
      typeof o.lastQuotaAlert100Month === "string" ? o.lastQuotaAlert100Month : null,
  };
}

/** Um e-mail por mês: 100% tem prioridade se os dois limiares ainda não foram avisados. */
export function quotaAlertToSend(
  alerts: Array<{ threshold: 80 | 100 }>,
  state: { monthKey: string; sent80: string | null; sent100: string | null },
): 80 | 100 | null {
  const need100 = alerts.some((alert) => alert.threshold === 100) && state.sent100 !== state.monthKey;
  const need80 = alerts.some((alert) => alert.threshold === 80) && state.sent80 !== state.monthKey;
  if (need100) return 100;
  if (need80) return 80;
  return null;
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

export async function listWhatsappBillableAlertAdmins(
  organizationId: string,
): Promise<WhatsappBillableAlertAdmin[]> {
  const admins = await prisma.user.findMany({
    where: {
      OR: [
        { organizationId, role: "ADMIN" },
        { memberships: { some: { organizationId, role: "ADMIN" } } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  return admins
    .filter((admin) => admin.email.includes("@"))
    .map((admin) => ({
      id: admin.id,
      name: admin.name.trim() || admin.email,
      email: admin.email.trim().toLowerCase(),
    }));
}

export async function setWhatsappConsumptionInsightsConfig(
  organizationId: string,
  patch: Partial<
    Pick<
      WhatsappConsumptionInsightsOrgConfig,
      "visibility" | "alertAdminOnBillable" | "billableAlertRecipientUserIds"
    >
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
  if (patch.billableAlertRecipientUserIds != null) {
    const allowed = new Set(
      (await listWhatsappBillableAlertAdmins(organizationId)).map((admin) => admin.id),
    );
    next.billableAlertRecipientUserIds = [
      ...new Set(patch.billableAlertRecipientUserIds.filter((id) => allowed.has(id))),
    ];
  }
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

/** Mês civil local — o mesmo recorte de `calendarMonthRange` na política WhatsApp. */
function currentCalendarMonth(): { from: Date; to: Date; monthKey: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { from, to, monthKey };
}

async function countBillableDeliveredThisMonth(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<number> {
  await reconcileWhatsappLedgerBillabilityForRange({ organizationId, from, to });
  return prisma.messageBillingLedgerEntry.count({
    where: {
      organizationId,
      channel: "WHATSAPP",
      metaBillable: true,
      billingStatus: { in: ["DELIVERED", "READ"] },
      sentAt: { gte: from, lte: to },
    },
  });
}

async function resolveBillableAlertRecipientEmails(
  organizationId: string,
  selectedUserIds: string[] | null,
): Promise<string[]> {
  const admins = await listWhatsappBillableAlertAdmins(organizationId);
  const chosen =
    selectedUserIds == null
      ? admins
      : admins.filter((admin) => selectedUserIds.includes(admin.id));
  return [...new Set(chosen.map((admin) => admin.email).filter((email) => email.includes("@")))];
}

/**
 * Uma vez por mês, se configurado.
 * A contagem é sempre o mês civil corrente (mensagens entregues e cobráveis),
 * independente do preset aberto no dashboard.
 */
export async function maybeNotifyWhatsappBillableStarted(organizationId: string): Promise<void> {
  const enabled = await isWhatsappConsumptionDashboardEnabled(organizationId);
  if (!enabled) return;

  const cfg = await getWhatsappConsumptionInsightsConfig(organizationId);
  if (cfg.visibility !== "super_admin_only" || !cfg.alertAdminOnBillable) return;

  const { from, to, monthKey } = currentCalendarMonth();
  if (cfg.lastBillableAlertMonth === monthKey) return;

  const billable = await countBillableDeliveredThisMonth(organizationId, from, to);
  if (billable <= 0) return;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!org) return;

  const recipients = await resolveBillableAlertRecipientEmails(
    organizationId,
    cfg.billableAlertRecipientUserIds,
  );
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

/**
 * Avisa os administradores selecionados quando a franquia Service do mês
 * cruza 80% e, depois, quando chega a 100%. Uma vez por limiar e por mês.
 */
export async function maybeNotifyWhatsappServiceQuota(params: {
  organizationId: string;
  alerts: Array<{ threshold: 80 | 100; percent: number }>;
}): Promise<void> {
  if (params.alerts.length === 0) return;
  const enabled = await isWhatsappConsumptionDashboardEnabled(params.organizationId);
  if (!enabled) return;

  const cfg = await getWhatsappConsumptionInsightsConfig(params.organizationId);
  if (cfg.visibility !== "super_admin_only" || !cfg.alertAdminOnBillable) return;

  const { monthKey } = currentCalendarMonth();
  const threshold = quotaAlertToSend(params.alerts, {
    monthKey,
    sent80: cfg.lastQuotaAlert80Month,
    sent100: cfg.lastQuotaAlert100Month,
  });
  if (threshold == null) return;

  const alert = params.alerts.find((row) => row.threshold === threshold);
  if (!alert) return;

  const org = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { name: true },
  });
  if (!org) return;

  const recipients = await resolveBillableAlertRecipientEmails(
    params.organizationId,
    cfg.billableAlertRecipientUserIds,
  );
  const cfgResend = await getResendEmailConfigFromDb();
  if (!cfgResend || recipients.length === 0) return;

  let sent = false;
  for (const toEmail of recipients) {
    const result = await sendWhatsappQuotaAlertEmail(cfgResend, toEmail, {
      organizationName: org.name,
      threshold,
      percent: alert.percent,
      monthKey,
    });
    if (result.ok) sent = true;
  }
  if (!sent) return;

  const map = await loadConfigMap();
  const current = map[params.organizationId] ?? { ...DEFAULT_CONFIG };
  map[params.organizationId] = {
    ...current,
    lastQuotaAlert80Month: monthKey,
    lastQuotaAlert100Month: threshold === 100 ? monthKey : current.lastQuotaAlert100Month,
  };
  await saveConfigMap(map);
}
