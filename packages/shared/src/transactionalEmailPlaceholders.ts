export function escapeHtmlForEmailPlaceholder(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sanitizeEmailSubjectLine(s: string): string {
  return s.replace(/\r?\n/g, " ").trim().slice(0, 300);
}

export type TransactionalEmailBrandVars = {
  appName: string;
  logoUrl: string;
};

export function buildLogoHtml(logoUrl: string, appName: string): string {
  const safeUrl = escapeHtmlForEmailPlaceholder(logoUrl);
  const safeName = escapeHtmlForEmailPlaceholder(appName);
  return `<img src="${safeUrl}" alt="${safeName}" style="max-height:48px;width:auto;display:block;margin:0 auto 16px;" />`;
}

export type TransactionalTemplateVars = TransactionalEmailBrandVars & Record<string, string>;

const BRAND_KEYS = ["{{appName}}", "{{logoUrl}}", "{{logoHtml}}"] as const;

function fillBrandInHtml(tpl: string, vars: TransactionalEmailBrandVars): string {
  const safeUrl = escapeHtmlForEmailPlaceholder(vars.logoUrl);
  const safeApp = escapeHtmlForEmailPlaceholder(vars.appName);
  const logoHtml = buildLogoHtml(vars.logoUrl, vars.appName);
  return tpl.split("{{logoHtml}}").join(logoHtml).split("{{logoUrl}}").join(safeUrl).split("{{appName}}").join(safeApp);
}

function fillBrandInSubject(tpl: string, vars: TransactionalEmailBrandVars): string {
  return tpl.split("{{logoUrl}}").join(vars.logoUrl).split("{{logoHtml}}").join("").split("{{appName}}").join(vars.appName);
}

/** Substitui placeholders de marca e campos extra (texto plano no assunto). */
export function fillTransactionalSubject(
  tpl: string,
  vars: TransactionalTemplateVars,
  extraKeys: string[],
): string {
  let out = fillBrandInSubject(tpl, vars);
  for (const key of extraKeys) {
    const token = `{{${key}}}`;
    const val = vars[key] ?? "";
    out = out.split(token).join(val);
  }
  return sanitizeEmailSubjectLine(out);
}

/** Substitui placeholders de marca e campos extra (HTML escapado nos valores). */
export function fillTransactionalHtml(
  tpl: string,
  vars: TransactionalTemplateVars,
  extraKeys: string[],
): string {
  let out = fillBrandInHtml(tpl, vars);
  for (const key of extraKeys) {
    const token = `{{${key}}}`;
    const raw = vars[key] ?? "";
    const safe = escapeHtmlForEmailPlaceholder(raw);
    out = out.split(token).join(safe);
  }
  return out;
}

export const TRANSACTIONAL_BRAND_PLACEHOLDERS = BRAND_KEYS;
