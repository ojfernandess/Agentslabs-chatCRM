import { config } from "../config.js";
import { prisma } from "../db.js";
import { isOrganizationFeatureEnabled } from "./featureFlags.js";
import { orgHasConfiguredMetaWhatsappInbox } from "./nvoipWhatsapp.js";
import { normalizeDialPhone } from "./nvoipCallContext.js";
import { readNvoipExternalConfig, mergeNvoipExternalConfig, type NvoipHomologationStored } from "./nvoipExternalConfig.js";
import { nvoipListUsers } from "./nvoipClient.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";

export type NvoipHomologationStatus = "pass" | "fail" | "warn" | "manual";

export type NvoipHomologationCheck = {
  id: string;
  label: string;
  status: NvoipHomologationStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type NvoipHomologationResult = {
  ranAt: string;
  checks: NvoipHomologationCheck[];
  summary: { pass: number; fail: number; warn: number; manual: number };
};

function summarize(checks: NvoipHomologationCheck[]) {
  return checks.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      return acc;
    },
    { pass: 0, fail: 0, warn: 0, manual: 0 },
  );
}

export async function runNvoipHomologation(organizationId: string): Promise<NvoipHomologationResult> {
  const ranAt = new Date().toISOString();
  const checks: NvoipHomologationCheck[] = [];

  const account = await prisma.nvoipAccount.findUnique({ where: { organizationId } });
  const ext = readNvoipExternalConfig(account?.externalConfig);

  const publicUrl = config.publicUrl?.replace(/\/+$/, "") ?? "";
  const callWebhook = publicUrl
    ? `${publicUrl}/webhooks/nvoip/${organizationId}`
    : null;
  const dtmfWebhook = publicUrl
    ? `${publicUrl}/webhooks/nvoip/${organizationId}/dtmf/{dispatchId}?token=…`
    : null;

  checks.push({
    id: "webhooks",
    label: "Webhooks de chamada",
    status: publicUrl ? "pass" : "fail",
    message: publicUrl
      ? "Configure estas URLs no painel Nvoip (se suportado): established / finished / inbound."
      : "PUBLIC_URL não definida — webhooks indisponíveis.",
    details: { callWebhook, dtmfWebhook },
  });

  const samples = ["11987654321", "+5511987654321", "5511987654321"];
  const normalized = samples.map((s) => ({ input: s, output: normalizeDialPhone(s) }));
  const allOk = normalized.every((n) => n.output?.startsWith("55") && (n.output?.length ?? 0) >= 12);
  checks.push({
    id: "called_format",
    label: "Formato internacional (called)",
    status: allOk ? "pass" : "warn",
    message: allOk
      ? "normalizeDialPhone produz E.164 BR (55…) para amostras locais."
      : "Revise DDI+DDD+número; amostras não normalizaram como esperado.",
    details: { samples: normalized },
  });

  if (!account || account.status !== "CONNECTED") {
    checks.push({
      id: "caller_ramal",
      label: "Caller (numbersip vs ramal)",
      status: "manual",
      message: "Conta não ligada — execute após POST /account/test.",
    });
  } else {
    try {
      const users = await nvoipListUsers(account);
      const webphoneUsers = users.filter((u) => u.webphone === true);
      const extensionCallers = (
        await prisma.nvoipAgentExtension.findMany({
          where: { organizationId },
          select: { caller: true, nvoipNumbersip: true, user: { select: { email: true } } },
        })
      ).map((e) => ({ caller: e.caller, numbersip: e.nvoipNumbersip, email: e.user.email }));

      const numbersipMatch = users.some(
        (u) => u.numbersip.replace(/\D/g, "") === account.numbersip.replace(/\D/g, ""),
      );

      checks.push({
        id: "caller_ramal",
        label: "Caller (numbersip vs ramal)",
        status: extensionCallers.length > 0 || users.length > 1 ? "pass" : "warn",
        message:
          users.length > 1
            ? `Conta numbersip=${account.numbersip}; ${users.length} ramais em /list/users. Use ramal do agente ou trunk como caller.`
            : `Caller da conta: ${account.defaultCaller}. Confirme com Nvoip se POST /calls/ aceita numbersip ou ramal secundário.`,
        details: {
          numbersip: account.numbersip,
          sipUsers: users.slice(0, 8).map((u) => ({
            numbersip: u.numbersip,
            caller: u.caller,
            name: u.name,
            webphone: u.webphone,
          })),
          agentExtensions: extensionCallers,
          numbersipListedAsUser: numbersipMatch,
        },
      });

      checks.push({
        id: "webphone_caller",
        label: "Webphone para click-to-call",
        status: webphoneUsers.length > 0 ? "pass" : "fail",
        message:
          webphoneUsers.length > 0
            ? `${webphoneUsers.length} ramal(is) com webphone activo. O CRM prioriza estes ramais em vez do NumberSIP trunk (${account.numbersip}).`
            : `Nenhum ramal com webphone na conta. Crie um ramal secundário com webphone no painel Nvoip ou registe o trunk SIP (${account.numbersip}) em app.nvoip.com.br — senão POST /calls/ falha em calling_origin.`,
        details: {
          webphoneUsers: webphoneUsers.slice(0, 8).map((u) => ({
            numbersip: u.numbersip,
            caller: u.caller,
            name: u.name,
          })),
          accountNumbersip: account.numbersip,
        },
      });
    } catch (err) {
      checks.push({
        id: "caller_ramal",
        label: "Caller (numbersip vs ramal)",
        status: "fail",
        message: err instanceof Error ? err.message : "list_users_failed",
      });
    }
  }

  if (!account?.tokenExpiresAt) {
    checks.push({
      id: "oauth_refresh",
      label: "Refresh token OAuth",
      status: account?.status === "CONNECTED" ? "warn" : "manual",
      message: "Sem tokenExpiresAt — ligue a conta para obter tokens.",
    });
  } else {
    const msLeft = account.tokenExpiresAt.getTime() - Date.now();
    checks.push({
      id: "oauth_refresh",
      label: "Refresh token OAuth",
      status: msLeft > 3_600_000 ? "pass" : msLeft > 0 ? "warn" : "fail",
      message:
        msLeft > 0
          ? `Access token expira em ~${Math.round(msLeft / 3_600_000)}h (refresh automático a cada 10 min).`
          : "Token expirado — teste ligação ou aguarde job de refresh.",
      details: { tokenExpiresAt: account.tokenExpiresAt.toISOString() },
    });
  }

  checks.push({
    id: "recording_lgpd",
    label: "Gravações linkAudio (LGPD)",
    status: ext.recordingRetentionDays != null ? "pass" : "warn",
    message:
      ext.recordingRetentionDays != null
        ? `Retenção configurada: ${ext.recordingRetentionDays} dias (política org).`
        : "Defina dias de retenção em Settings → Nvoip para alinhar com LGPD.",
    details: { recordingRetentionDays: ext.recordingRetentionDays },
  });

  const waEnabled = await isOrganizationFeatureEnabled(organizationId, "nvoip_whatsapp");
  if (!waEnabled) {
    checks.push({
      id: "whatsapp_instance",
      label: "WhatsApp HSM (instance Meta)",
      status: "manual",
      message: "Flag nvoip_whatsapp desligada — não aplicável.",
    });
  } else {
    const metaInbox = await orgHasConfiguredMetaWhatsappInbox(organizationId);
    checks.push({
      id: "whatsapp_instance",
      label: "WhatsApp HSM (instance Meta)",
      status: metaInbox ? "fail" : account?.waInstance?.trim() ? "pass" : "warn",
      message: metaInbox
        ? "Bloqueado: caixa Meta/360dialog já configurada."
        : account?.waInstance?.trim()
          ? `Instance Meta: ${account.waInstance}`
          : "Defina waInstance na conta Nvoip.",
      details: { hasMetaInbox: metaInbox, waInstance: account?.waInstance ?? null },
    });
  }

  const summary = summarize(checks);
  const stored: NvoipHomologationStored = { ranAt, ...summary };

  if (account) {
    const merged = mergeNvoipExternalConfig(account.externalConfig, { homologationLast: stored });
    await prisma.nvoipAccount.update({
      where: { id: account.id },
      data: { externalConfig: merged },
    });
    await writeNvoipIntegrationLog({
      organizationId,
      nvoipAccountId: account.id,
      level: summary.fail > 0 ? "warn" : "info",
      eventType: "homologation_run",
      message: `Homologação: ${summary.pass} ok, ${summary.fail} falha, ${summary.warn} aviso`,
      payload: { summary },
    });
  }

  return { ranAt, checks, summary };
}
