import type { NvoipAccount } from "@prisma/client";
import { Resend } from "resend";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { readNvoipExternalConfig, mergeNvoipExternalConfig } from "./nvoipExternalConfig.js";
import { writeNvoipIntegrationLog } from "./nvoipIntegrationLog.js";
import { getResendEmailConfigFromDb } from "./resendEmailSettings.js";

const ALERT_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function parseNvoipBalanceBrl(balance: string): number | null {
  const normalized = balance.replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

async function resolveBalanceAlertRecipients(
  organizationId: string,
  explicitEmails: string[],
): Promise<string[]> {
  const fromConfig = explicitEmails.filter((e) => e.includes("@"));
  if (fromConfig.length > 0) return [...new Set(fromConfig)];

  const admins = await prisma.user.findMany({
    where: { organizationId, role: "ADMIN" },
    select: { email: true },
  });
  return [...new Set(admins.map((a) => a.email.trim().toLowerCase()).filter((e) => e.includes("@")))];
}

async function sendLowBalanceEmails(input: {
  organizationId: string;
  organizationName: string;
  recipients: string[];
  balanceRaw: string;
  thresholdBrl: number;
}): Promise<{ sent: number; error: string | null }> {
  const cfg = await getResendEmailConfigFromDb();
  if (!cfg) return { sent: 0, error: "resend_not_configured" };
  if (input.recipients.length === 0) return { sent: 0, error: "no_recipients" };

  const resend = new Resend(cfg.apiKey);
  const subject = `[OpenConduit] Saldo Nvoip baixo — ${input.organizationName}`;
  const html = `
    <p>O saldo da conta Nvoip da organização <strong>${input.organizationName}</strong> está abaixo do limiar configurado.</p>
    <ul>
      <li><strong>Saldo atual:</strong> ${input.balanceRaw}</li>
      <li><strong>Limiar:</strong> R$ ${input.thresholdBrl.toFixed(2)}</li>
    </ul>
    <p>Recarregue no painel Nvoip ou ajuste o limiar em Configurações → Integração Nvoip.</p>
  `;

  let sent = 0;
  let lastError: string | null = null;
  for (const to of input.recipients) {
    const { error } = await resend.emails.send({
      from: `${cfg.fromName} <${cfg.fromEmail}>`,
      to: [to],
      subject,
      html,
    });
    if (error) {
      lastError = typeof error.message === "string" ? error.message : "resend_error";
    } else {
      sent += 1;
    }
  }
  return { sent, error: lastError };
}

export async function maybeAlertNvoipLowBalance(
  account: NvoipAccount,
  balanceRaw: string,
): Promise<{
  low: boolean;
  thresholdBrl: number;
  balanceBrl: number | null;
  emailSent: boolean;
}> {
  const ext = readNvoipExternalConfig(account.externalConfig);
  const thresholdBrl = ext.lowBalanceAlertBrl ?? config.nvoipDefaultBalanceAlertBrl;
  const balanceBrl = parseNvoipBalanceBrl(balanceRaw);
  const low = balanceBrl != null && balanceBrl < thresholdBrl;

  let emailSent = false;

  if (low) {
    await writeNvoipIntegrationLog({
      organizationId: account.organizationId,
      nvoipAccountId: account.id,
      level: "warn",
      eventType: "balance_low",
      message: `Saldo Nvoip abaixo de R$ ${thresholdBrl.toFixed(2)}: ${balanceRaw}`,
      payload: { balanceBrl, thresholdBrl },
    });

    const lastSent = ext.lastBalanceAlertEmailAt
      ? new Date(ext.lastBalanceAlertEmailAt).getTime()
      : 0;
    const cooldownOk = Date.now() - lastSent > ALERT_EMAIL_COOLDOWN_MS;

    if (cooldownOk) {
      const org = await prisma.organization.findUnique({
        where: { id: account.organizationId },
        select: { name: true },
      });
      const recipients = await resolveBalanceAlertRecipients(
        account.organizationId,
        ext.balanceAlertEmails,
      );
      const mail = await sendLowBalanceEmails({
        organizationId: account.organizationId,
        organizationName: org?.name ?? account.organizationId,
        recipients,
        balanceRaw,
        thresholdBrl,
      });
      emailSent = mail.sent > 0;

      const merged = mergeNvoipExternalConfig(account.externalConfig, {
        lastBalanceAlertEmailAt: new Date().toISOString(),
      });
      await prisma.nvoipAccount.update({
        where: { id: account.id },
        data: { externalConfig: merged },
      });

      await writeNvoipIntegrationLog({
        organizationId: account.organizationId,
        nvoipAccountId: account.id,
        level: mail.sent > 0 ? "info" : "warn",
        eventType: "balance_low_email",
        message:
          mail.sent > 0
            ? `Alerta de saldo enviado a ${mail.sent} destinatário(s).`
            : `Falha ao enviar alerta: ${mail.error ?? "unknown"}`,
        payload: { recipients, sent: mail.sent, error: mail.error },
      });
    }
  }

  return { low, thresholdBrl, balanceBrl, emailSent };
}
