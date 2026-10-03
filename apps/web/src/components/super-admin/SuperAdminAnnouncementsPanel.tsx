import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { announcementText } from "@/components/announcements/announcementCopy";
import {
  AnnouncementCard,
  AnnouncementCta,
  AnnouncementMarkdown,
  CategoryMark,
  type AnnouncementCategoryView,
  type AnnouncementView,
} from "@/components/announcements/announcementUi";

type Status = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

type AdminItem = AnnouncementView & {
  status: Status;
  audienceLabel: string;
  readCount: number;
  targets?: { targetType: string; targetId: string }[];
};

type ListResponse = {
  items: AdminItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<Status, number>;
};

type FormState = {
  id?: string;
  status?: Status;
  title: string;
  summary: string;
  content: string;
  categoryId: string;
  coverUrl: string;
  priority: "NORMAL" | "IMPORTANT" | "CRITICAL";
  isFeatured: boolean;
  isPinned: boolean;
  notifyUsers: boolean;
  requiresAcknowledgement: boolean;
  when: "now" | "later";
  scheduledLocal: string;
  expiresLocal: string;
  ctaLabel: string;
  ctaUrl: string;
  audienceType: "ALL" | "ORGANIZATIONS" | "PLANS";
  organizationIds: string[];
  orgNames: Record<string, string>;
  planIds: string[];
};

const EMPTY: FormState = {
  title: "",
  summary: "",
  content: "",
  categoryId: "",
  coverUrl: "",
  priority: "NORMAL",
  isFeatured: false,
  isPinned: false,
  notifyUsers: true,
  requiresAcknowledgement: false,
  when: "now",
  scheduledLocal: "",
  expiresLocal: "",
  ctaLabel: "",
  ctaUrl: "",
  audienceType: "ALL",
  organizationIds: [],
  orgNames: {},
  planIds: [],
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function SuperAdminAnnouncementsPanel() {
  const { locale } = useI18n();
  const copy = announcementText(locale);
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const [status, setStatus] = useState<Status | "">("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResponse | null>(null);
  const [categories, setCategories] = useState<AnnouncementCategoryView[]>([]);
  const [plans, setPlans] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<"desktop" | "mobile" | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<{ organizations: number; users: number } | null>(null);
  const [metrics, setMetrics] = useState<{ id: string; organizations: number; eligibleUsers: number; reads: number; readRate: number; acknowledgements: number } | null>(null);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgHits, setOrgHits] = useState<{ id: string; name: string }[]>([]);
  const [categoryName, setCategoryName] = useState("");

  const load = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    void api.get<ListResponse>(`/super/announcements?${params.toString()}`).then(setList).catch(() => setError(copy.loadError));
  };

  useEffect(() => { load(); }, [page, status]);
  useEffect(() => {
    void api.get<AnnouncementCategoryView[]>("/super/announcements/categories").then(setCategories);
    void api.get<{ id: string; name: string; slug: string }[]>("/super/announcements/plans").then(setPlans);
  }, []);

  useEffect(() => {
    if (!editing || editing.audienceType !== "ORGANIZATIONS") return;
    const handle = window.setTimeout(() => {
      void api.get<{ id: string; name: string }[]>(`/super/announcements/organizations?q=${encodeURIComponent(orgQuery)}`).then(setOrgHits);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [orgQuery, editing?.audienceType]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const patch = (partial: Partial<FormState>) => {
    setEditing((current) => current ? { ...current, ...partial } : current);
    setDirty(true);
  };

  const openNew = () => {
    setEditing({ ...EMPTY, categoryId: categories[0]?.id ?? "" });
    setDirty(false);
    setMessage("");
    setError("");
  };

  const openExisting = async (id: string) => {
    const row = await api.get<AdminItem & { scheduledAt?: string | null; expiresAt?: string | null; notifyUsers?: boolean }>(`/super/announcements/${id}`);
    const orgIds = (row.targets ?? []).filter((t) => t.targetType === "ORGANIZATION").map((t) => t.targetId);
    const planIds = (row.targets ?? []).filter((t) => t.targetType === "PLAN").map((t) => t.targetId);
    setEditing({
      id: row.id,
      status: row.status,
      title: row.title,
      summary: row.summary,
      content: row.content,
      categoryId: row.category.id,
      coverUrl: row.coverUrl ?? "",
      priority: row.priority,
      isFeatured: row.isFeatured,
      isPinned: row.isPinned,
      notifyUsers: row.notifyUsers ?? true,
      requiresAcknowledgement: row.requiresAcknowledgement,
      when: row.status === "SCHEDULED" ? "later" : "now",
      scheduledLocal: toLocalInput(row.scheduledAt),
      expiresLocal: toLocalInput(row.expiresAt),
      ctaLabel: row.ctaLabel ?? "",
      ctaUrl: row.ctaUrl ?? "",
      audienceType: row.targets?.some((t) => t.targetType === "ALL") ? "ALL" : planIds.length ? "PLANS" : "ORGANIZATIONS",
      organizationIds: orgIds,
      orgNames: Object.fromEntries(orgIds.map((orgId) => [orgId, orgId])),
      planIds,
    });
    setDirty(false);
  };

  const payload = (action: "draft" | "publish" | "schedule") => {
    if (!editing) throw new Error("empty");
    return {
      title: editing.title,
      summary: editing.summary,
      content: editing.content,
      categoryId: editing.categoryId,
      coverUrl: editing.coverUrl || null,
      priority: editing.priority,
      isFeatured: editing.isFeatured,
      isPinned: editing.isPinned,
      notifyUsers: editing.notifyUsers,
      requiresAcknowledgement: editing.requiresAcknowledgement,
      scheduledAt: action === "schedule" ? fromLocalInput(editing.scheduledLocal) : null,
      expiresAt: fromLocalInput(editing.expiresLocal),
      ctaLabel: editing.ctaLabel || null,
      ctaUrl: editing.ctaUrl || null,
      audience: {
        type: editing.audienceType,
        organizationIds: editing.organizationIds,
        planIds: editing.planIds,
      },
      action,
    };
  };

  const save = async (action: "draft" | "publish" | "schedule") => {
    if (!editing) return;
    setError("");
    try {
      const body = payload(action);
      const saved = editing.id
        ? await api.patch<AdminItem>(`/super/announcements/${editing.id}`, body)
        : await api.post<AdminItem>("/super/announcements", body);
      setDirty(false);
      const stayedPublished = action === "draft" && editing.status === "PUBLISHED";
      setMessage(action === "publish" ? copy.publishedOk : action === "schedule" ? copy.scheduledOk : stayedPublished ? (locale === "en" ? "Changes saved." : "Alterações salvas.") : copy.saved);
      setEditing(null);
      setConfirmPublish(null);
      load();
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
    }
  };

  const askPublish = async () => {
    if (!editing) return;
    try {
      const previewAudience = await api.post<{ organizations: number; users: number }>("/super/announcements/audience-preview", {
        type: editing.audienceType,
        organizationIds: editing.organizationIds,
        planIds: editing.planIds,
      });
      setConfirmPublish(previewAudience);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
    }
  };

  const leaveEditor = () => {
    if (dirty && !window.confirm(copy.unsaved)) return;
    setEditing(null);
    setDirty(false);
  };

  if (editing) {
    const category = categories.find((item) => item.id === editing.categoryId) ?? categories[0];
    const previewItem: AnnouncementView | null = category ? {
      id: "preview",
      title: editing.title || copy.title,
      summary: editing.summary,
      content: editing.content,
      coverUrl: editing.coverUrl || null,
      priority: editing.priority,
      isFeatured: editing.isFeatured,
      isPinned: editing.isPinned,
      requiresAcknowledgement: editing.requiresAcknowledgement,
      publishedAt: new Date().toISOString(),
      ctaLabel: editing.ctaLabel || null,
      ctaUrl: editing.ctaUrl || null,
      category,
      unread: true,
    } : null;
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-gray-900">{editing.id ? editing.title : copy.adminNew}</h1>
          <button type="button" className="min-h-11 text-sm" onClick={leaveEditor}>{copy.cancel}</button>
        </div>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">{copy.content}</h2>
          <label className="block text-xs text-gray-600">{copy.title}<input className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.title} onChange={(e) => patch({ title: e.target.value })} /></label>
          <label className="block text-xs text-gray-600">{copy.summary}<textarea className="mt-1 w-full rounded-lg border px-3 py-2" rows={2} value={editing.summary} onChange={(e) => patch({ summary: e.target.value })} /></label>
          <label className="block text-xs text-gray-600">{copy.category}
            <select className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
              {categories.filter((item) => item).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-gray-600">{copy.cover}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="mt-1 block text-sm" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              void api.postMultipart<{ coverUrl: string }>("/super/announcements/cover", form).then((row) => patch({ coverUrl: row.coverUrl }));
            }} />
            <span className="mt-1 block text-gray-500">{copy.coverHint}</span>
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            {["## ", "**", "*", "- ", "> ", "---"].map((token) => (
              <button key={token} type="button" className="rounded-lg border px-2 py-1" onClick={() => patch({ content: `${editing.content}${editing.content.endsWith("\n") || !editing.content ? "" : "\n"}${token === "**" || token === "*" ? `${token}texto${token}` : token}` })}>{token.trim() || "—"}</button>
            ))}
          </div>
          <textarea className="min-h-48 w-full rounded-lg border px-3 py-2 font-mono text-sm" value={editing.content} onChange={(e) => patch({ content: e.target.value })} aria-label={copy.body} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-gray-600">{copy.ctaText}<input className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} /></label>
            <label className="text-xs text-gray-600">{copy.ctaUrl}<input className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.ctaUrl} onChange={(e) => patch({ ctaUrl: e.target.value })} placeholder="/settings ou https://" /></label>
          </div>
        </section>
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">{copy.audience}</h2>
          {(["ALL", "ORGANIZATIONS", "PLANS"] as const).map((type) => (
            <label key={type} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" checked={editing.audienceType === type} onChange={() => patch({ audienceType: type })} />
              {type === "ALL" ? copy.allOrgs : type === "ORGANIZATIONS" ? copy.specificOrgs : copy.specificPlans}
            </label>
          ))}
          {editing.audienceType === "ORGANIZATIONS" ? (
            <div>
              <input className="min-h-11 w-full rounded-lg border px-3" placeholder={copy.searchOrgs} value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} />
              <ul className="mt-2 max-h-40 overflow-auto text-sm">
                {orgHits.map((org) => (
                  <li key={org.id}>
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" checked={editing.organizationIds.includes(org.id)} onChange={() => {
                        const selected = editing.organizationIds.includes(org.id)
                          ? editing.organizationIds.filter((id) => id !== org.id)
                          : [...editing.organizationIds, org.id];
                        patch({ organizationIds: selected, orgNames: { ...editing.orgNames, [org.id]: org.name } });
                      }} />
                      {org.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {editing.audienceType === "PLANS" ? (
            plans.length === 0 ? <p className="text-sm text-gray-500">{copy.noPlans}</p> : (
              <ul>
                {plans.map((plan) => (
                  <li key={plan.id}>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" checked={editing.planIds.includes(plan.id)} onChange={() => {
                        patch({
                          planIds: editing.planIds.includes(plan.id)
                            ? editing.planIds.filter((id) => id !== plan.id)
                            : [...editing.planIds, plan.id],
                        });
                      }} />
                      {plan.name}
                    </label>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </section>
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-800">{copy.when}</h2>
          <label className="block text-xs text-gray-600">{copy.priority}
            <select className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.priority} onChange={(e) => patch({ priority: e.target.value as FormState["priority"], requiresAcknowledgement: e.target.value === "NORMAL" ? false : editing.requiresAcknowledgement })}>
              <option value="NORMAL">{copy.normal}</option>
              <option value="IMPORTANT">{copy.important}</option>
              <option value="CRITICAL">{copy.critical}</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={editing.notifyUsers} onChange={(e) => patch({ notifyUsers: e.target.checked })} />{copy.notify}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={editing.isFeatured} onChange={(e) => patch({ isFeatured: e.target.checked })} />{copy.feature}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={editing.isPinned} onChange={(e) => patch({ isPinned: e.target.checked })} />{copy.pin}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={editing.priority === "NORMAL"} checked={editing.requiresAcknowledgement} onChange={(e) => patch({ requiresAcknowledgement: e.target.checked })} />{copy.requireAck}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={editing.when === "now"} onChange={() => patch({ when: "now" })} />{copy.now}</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" checked={editing.when === "later"} onChange={() => patch({ when: "later" })} />{copy.later}</label>
          {editing.when === "later" ? (
            <label className="block text-xs text-gray-600">{copy.date}
              <input type="datetime-local" className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.scheduledLocal} onChange={(e) => patch({ scheduledLocal: e.target.value })} />
              <span className="mt-1 block">{copy.timezone}: {timezone}</span>
            </label>
          ) : null}
          <label className="block text-xs text-gray-600">{copy.visibleUntil}
            <input type="datetime-local" className="mt-1 min-h-11 w-full rounded-lg border px-3" value={editing.expiresLocal} onChange={(e) => patch({ expiresLocal: e.target.value })} />
          </label>
        </section>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-xl border px-4 text-sm" onClick={() => void save("draft")}>{copy.saveDraft}</button>
          <button type="button" className="min-h-11 rounded-xl border px-4 text-sm" onClick={() => setPreview("desktop")}>{copy.preview}</button>
          {editing.when === "later" ? (
            <button type="button" className="min-h-11 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white" onClick={() => void save("schedule")}>{copy.schedule}</button>
          ) : (
            <button type="button" className="min-h-11 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white" onClick={() => void askPublish()}>{copy.publish}</button>
          )}
        </div>
        <section className="rounded-2xl border border-dashed border-gray-300 p-4">
          <h2 className="text-sm font-semibold">{copy.addCategory}</h2>
          <div className="mt-2 flex gap-2">
            <input className="min-h-11 flex-1 rounded-lg border px-3" placeholder={copy.categoryName} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
            <button type="button" className="min-h-11 rounded-xl border px-3 text-sm" onClick={() => {
              if (categoryName.trim().length < 2) return;
              void api.post<AnnouncementCategoryView>("/super/announcements/categories", { name: categoryName.trim(), icon: "Info", tone: "slate" }).then((row) => {
                setCategories((current) => [...current, row]);
                setCategoryName("");
              });
            }}>{copy.addCategory}</button>
          </div>
        </section>
        {preview && previewItem ? (
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true">
            <div className={`max-h-[90vh] overflow-auto rounded-2xl bg-white p-4 ${preview === "mobile" ? "w-full max-w-sm" : "w-full max-w-3xl"}`}>
              <div className="mb-3 flex gap-2">
                <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => setPreview("desktop")}>{copy.desktop}</button>
                <button type="button" className="min-h-11 rounded-lg border px-3 text-sm" onClick={() => setPreview("mobile")}>{copy.mobile}</button>
                <button type="button" className="ml-auto min-h-11 text-sm" onClick={() => setPreview(null)}>{copy.cancel}</button>
              </div>
              <AnnouncementCard item={previewItem} copy={copy} locale={locale} />
              <div className="mt-4 space-y-3">
                <AnnouncementMarkdown content={previewItem.content} />
                {previewItem.ctaLabel && previewItem.ctaUrl ? <AnnouncementCta label={previewItem.ctaLabel} url={previewItem.ctaUrl} /> : null}
              </div>
            </div>
          </div>
        ) : null}
        {confirmPublish ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-2xl bg-white p-5">
              <h2 className="text-lg font-semibold">{copy.publishConfirm}</h2>
              <p className="mt-2 text-sm text-gray-600">{copy.publishHint}</p>
              <p className="mt-3 text-sm font-medium">{confirmPublish.users.toLocaleString(locale)} {copy.users} · {confirmPublish.organizations.toLocaleString(locale)} {copy.organizations}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setConfirmPublish(null)}>{copy.cancel}</button>
                <button type="button" className="min-h-11 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white" onClick={() => void save("publish")}>{copy.confirm}</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const counts = list?.counts;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{copy.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{copy.subtitle}</p>
        </div>
        <button type="button" className="min-h-11 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white" onClick={openNew}>{copy.adminNew}</button>
      </div>
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["PUBLISHED", "SCHEDULED", "DRAFT", "ARCHIVED"] as const).map((key) => (
          <button key={key} type="button" onClick={() => { setStatus(status === key ? "" : key); setPage(1); }} className={`rounded-2xl border p-3 text-left ${status === key ? "border-gray-900" : "border-gray-200"}`}>
            <div className="text-xs text-gray-500">{copy[key === "PUBLISHED" ? "published" : key === "SCHEDULED" ? "scheduled" : key === "DRAFT" ? "draft" : "archived"]}</div>
            <div className="mt-1 text-2xl font-semibold">{counts?.[key] ?? 0}</div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="min-h-11 flex-1 rounded-xl border px-3" placeholder={copy.adminSearch} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); load(); } }} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-3">{copy.title}</th>
              <th className="px-3 py-3">{copy.category}</th>
              <th className="px-3 py-3">{copy.audienceCol}</th>
              <th className="px-3 py-3">{copy.status}</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {list?.items.map((item) => (
              <tr key={item.id} className="border-t border-gray-100">
                <td className="px-3 py-3 font-medium">{item.title}</td>
                <td className="px-3 py-3"><CategoryMark category={item.category} /></td>
                <td className="px-3 py-3">{item.audienceLabel === "ALL" ? copy.allOrgs : item.audienceLabel === "PLANS" ? copy.specificPlans : copy.specificOrgs}</td>
                <td className="px-3 py-3">{item.status}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="min-h-11 text-xs font-medium" onClick={() => void openExisting(item.id)}>{locale === "en" ? "Edit" : "Editar"}</button>
                    <button type="button" className="min-h-11 text-xs" onClick={() => void api.get<{ organizations: number; eligibleUsers: number; reads: number; readRate: number; acknowledgements: number }>(`/super/announcements/${item.id}/metrics`).then((row) => setMetrics({ id: item.id, ...row }))}>{copy.metrics}</button>
                    <button type="button" className="min-h-11 text-xs" onClick={() => void api.post(`/super/announcements/${item.id}/duplicate`).then(() => load())}>{copy.duplicate}</button>
                    {item.status === "PUBLISHED" ? (
                      <button type="button" className="min-h-11 text-xs" onClick={() => { if (window.confirm(copy.renotifyConfirm)) void api.post(`/super/announcements/${item.id}/renotify`).then(() => load()); }}>{copy.renotify}</button>
                    ) : null}
                    {item.status !== "ARCHIVED" ? (
                      <button type="button" className="min-h-11 text-xs" onClick={() => void api.post(`/super/announcements/${item.id}/archive`).then(() => load())}>{copy.archive}</button>
                    ) : null}
                    <button type="button" className="min-h-11 text-xs text-rose-700" onClick={() => { if (window.confirm(copy.removeConfirm)) void api.delete(`/super/announcements/${item.id}`).then(() => load()); }}>{copy.remove}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {metrics ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h2 className="text-lg font-semibold">{copy.metrics}</h2>
            <p className="mt-1 text-xs text-gray-500">{copy.metricsHint}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-gray-500">{copy.reachedOrgs}</dt><dd className="text-xl font-semibold">{metrics.organizations}</dd></div>
              <div><dt className="text-gray-500">{copy.eligibleUsers}</dt><dd className="text-xl font-semibold">{metrics.eligibleUsers}</dd></div>
              <div><dt className="text-gray-500">{copy.reads}</dt><dd className="text-xl font-semibold">{metrics.reads}</dd></div>
              <div><dt className="text-gray-500">{copy.readRate}</dt><dd className="text-xl font-semibold">{metrics.readRate.toLocaleString(locale)}%</dd></div>
              <div><dt className="text-gray-500">{copy.acks}</dt><dd className="text-xl font-semibold">{metrics.acknowledgements}</dd></div>
            </dl>
            <button type="button" className="mt-4 min-h-11 text-sm" onClick={() => setMetrics(null)}>{copy.cancel}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
