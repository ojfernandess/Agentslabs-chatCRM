/** Próximo dia no calendário local como YYYY-MM-DD. */
export function tomorrowLocalYmd(): string {
  const x = new Date();
  x.setDate(x.getDate() + 1);
  const yy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Data (YYYY-MM-DD) + hora do input time → ISO UTC. */
export function localDueToIso(dueDate: string, dueTime: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
  if (!dm) throw new RangeError("invalid_due_date");
  const y = Number(dm[1]);
  const mo = Number(dm[2]);
  const d = Number(dm[3]);
  const t = dueTime.trim();
  let h = 9;
  let mi = 0;
  let s = 0;
  if (t) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
    if (!tm) throw new RangeError("invalid_due_time");
    h = Number(tm[1]);
    mi = Number(tm[2]);
    s = tm[3] != null ? Number(tm[3]) : 0;
  }
  const local = new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(local.getTime())) throw new RangeError("invalid_due_at");
  return local.toISOString();
}
