import { Resend } from "resend";
import { buildWhatsappBillableAlertEmailContent } from "@openconduit/shared";
import type { ResendEmailConfig } from "./resendEmailSettings.js";
import { resolveSystemLogoUrl, resolveWhatsappBillableAlertTemplates } from "./resendEmailSettings.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function resendError(error: unknown): string {
  return typeof error === "object" && error && "message" in error
    ? String((error as { message: unknown }).message)
    : "resend_error";
}

export async function sendWhatsappBillableAlertEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  vars: {
    organizationName: string;
    billableCount: number;
    monthKey: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const { subjectTpl, htmlTpl } = resolveWhatsappBillableAlertTemplates(cfg);
  const { subject, html } = buildWhatsappBillableAlertEmailContent(subjectTpl, htmlTpl, {
    appName: cfg.fromName,
    logoUrl: resolveSystemLogoUrl(cfg),
    organizationName: vars.organizationName,
    billableCount: String(vars.billableCount),
    monthKey: vars.monthKey,
  });

  const { data, error } = await resend.emails.send({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    to: [toEmail],
    subject,
    html,
  });

  if (error) {
    return { ok: false, error: resendError(error) };
  }
  if (!data?.id) {
    return { ok: false, error: "no_message_id" };
  }
  return { ok: true };
}

export async function sendWhatsappQuotaAlertEmail(
  cfg: ResendEmailConfig,
  toEmail: string,
  vars: {
    organizationName: string;
    threshold: 80 | 100;
    percent: number;
    monthKey: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resend = new Resend(cfg.apiKey);
  const percentLabel = String(Math.round(vars.percent));
  const organizationName = escapeHtml(vars.organizationName);
  const monthKey = escapeHtml(vars.monthKey);
  const fromName = escapeHtml(cfg.fromName);
  const subject =
    vars.threshold === 100
      ? `WhatsApp — franquia Service esgotada — ${vars.organizationName} (${vars.monthKey})`
      : `WhatsApp — franquia Service em ${vars.threshold}% — ${vars.organizationName} (${vars.monthKey})`;
  const lead =
    vars.threshold === 100
      ? `A organização <strong>${organizationName}</strong> atingiu <strong>${percentLabel}%</strong> da franquia mensal de mensagens Service em <strong>${monthKey}</strong>.`
      : `A organização <strong>${organizationName}</strong> utilizou <strong>${percentLabel}%</strong> da franquia mensal de mensagens Service em <strong>${monthKey}</strong>.`;
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #1f2937;">
  <p>Olá,</p>
  <p>${lead}</p>
  <p>Consulte o painel WhatsApp — Política e Consumo para o detalhe por categoria.</p>
  <p style="font-size: 12px; color: #6b7280;">Enviado pelo ${fromName}.</p>
</body>
</html>`;

  const { data, error } = await resend.emails.send({
    from: `${cfg.fromName} <${cfg.fromEmail}>`,
    to: [toEmail],
    subject,
    html,
  });
  if (error) return { ok: false, error: resendError(error) };
  if (!data?.id) return { ok: false, error: "no_message_id" };
  return { ok: true };
}
