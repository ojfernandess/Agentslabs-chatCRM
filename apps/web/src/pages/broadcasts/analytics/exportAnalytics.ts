import type { BroadcastCampaignAnalytics } from "./types";

export function openAnalyticsPdfReport(
  data: BroadcastCampaignAnalytics,
  labels: {
    title: string;
    period: string;
    summary: string;
    sendLog: string;
    errors: string;
  },
): void {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;

  const summary = data.summary;
  const rows = data.sendLog.items
    .slice(0, 500)
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.sentAt ?? r.createdAt)}</td><td>${escapeHtml(r.campaignName)}</td><td>${escapeHtml(r.phone ?? r.email ?? "—")}</td><td>${escapeHtml(r.channel)}</td><td>${escapeHtml(r.status)}</td></tr>`,
    )
    .join("");

  const errRows = data.errorsByCategory
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.category)}</td><td>${e.count}</td><td>${escapeHtml(e.affectedPhones.slice(0, 5).join(", "))}</td></tr>`,
    )
    .join("");

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(labels.title)}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}th,td{border:1px solid #ccc;padding:6px;text-align:left}h1{font-size:18px}h2{font-size:14px;margin-top:24px}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metric{border:1px solid #ddd;padding:8px 12px;border-radius:8px}</style></head><body>
<h1>${escapeHtml(labels.title)}</h1>
<p>${escapeHtml(labels.period)}: ${escapeHtml(data.filters.from.slice(0, 10))} — ${escapeHtml(data.filters.to.slice(0, 10))}</p>
<h2>${escapeHtml(labels.summary)}</h2>
<div class="metrics">
<div class="metric">Total: ${summary.total}</div>
<div class="metric">Enviadas: ${summary.sent}</div>
<div class="metric">Falhas: ${summary.failed}</div>
<div class="metric">Entrega: ${summary.deliveryRate ?? "—"}%</div>
<div class="metric">Engajamento: ${summary.engagementRate ?? "—"}%</div>
</div>
<h2>${escapeHtml(labels.errors)}</h2>
<table><thead><tr><th>Categoria</th><th>Qtd</th><th>Contactos</th></tr></thead><tbody>${errRows || "<tr><td colspan=3>—</td></tr>"}</tbody></table>
<h2>${escapeHtml(labels.sendLog)}</h2>
<table><thead><tr><th>Data</th><th>Campanha</th><th>Contacto</th><th>Canal</th><th>Estado</th></tr></thead><tbody>${rows || "<tr><td colspan=5>—</td></tr>"}</tbody></table>
<script>window.onload=function(){window.print()}</script>
</body></html>`);
  w.document.close();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
