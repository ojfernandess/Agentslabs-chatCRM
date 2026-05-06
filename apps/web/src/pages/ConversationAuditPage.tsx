import { useState, useEffect, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { FileSearch, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { PageTransition, motion } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useAuth } from "@/hooks/useAuth";
import { isTenantAdmin } from "@/lib/authRole";
import { Navigate } from "react-router-dom";

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface LeadTypeRow {
  id: string;
  name: string;
  color: string;
}

interface AuditRow {
  id: string;
  status: string;
  updatedAt: string;
  closureValue: number | null;
  closureReason: string | null;
  contact: {
    id: string;
    name: string;
    phone: string;
    createdAt: string;
    assignedTo: { id: string; name: string; email: string } | null;
    createdBy: { id: string; name: string; email: string } | null;
  };
  assignedTo: { id: string; name: string; email: string } | null;
  team: { id: string; name: string } | null;
  leadType: { id: string; name: string; color: string } | null;
}

export function ConversationAuditPage() {
  const { t, locale, dateLocale } = useI18n();
  const { user } = useAuth();
  const tenantAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [leadTypes, setLeadTypes] = useState<LeadTypeRow[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  const [assigneeId, setAssigneeId] = useState("");
  const [leadTypeId, setLeadTypeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [resolvedFrom, setResolvedFrom] = useState("");
  const [resolvedTo, setResolvedTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat(locale === "pt-BR" ? "pt-BR" : "en-US", {
      style: "currency",
      currency: locale === "pt-BR" ? "BRL" : "USD",
    }).format(n);

  useEffect(() => {
    if (!tenantAdmin) return;
    async function meta() {
      try {
        const [u, lt, tm] = await Promise.all([
          api.get<TeamUser[]>("/users"),
          api.get<LeadTypeRow[]>("/lead-types"),
          api.get<{ data: { id: string; name: string }[] }>("/teams"),
        ]);
        setUsers(u);
        setLeadTypes(lt);
        setTeams(tm.data.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        setUsers([]);
        setLeadTypes([]);
        setTeams([]);
      }
    }
    void meta();
  }, [tenantAdmin]);

  const runQuery = async (e?: FormEvent, nextPage = 1) => {
    e?.preventDefault();
    if (!tenantAdmin) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        pageSize: String(pageSize),
        page: String(nextPage),
        status: "RESOLVED",
      });
      if (assigneeId) params.set("assignedToId", assigneeId);
      if (leadTypeId) params.set("leadTypeId", leadTypeId);
      if (teamId) params.set("teamId", teamId);
      if (resolvedFrom) params.set("resolvedFrom", new Date(resolvedFrom).toISOString());
      if (resolvedTo) params.set("resolvedTo", new Date(resolvedTo).toISOString());
      const res = await api.get<{ data: AuditRow[]; total: number }>(
        `/conversations/audit?${params}`,
      );
      setRows(res.data);
      setTotal(res.total);
      setPage(nextPage);
    } catch {
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantAdmin) void runQuery(undefined, 1);
  }, [tenantAdmin]);

  if (!tenantAdmin) {
    return <Navigate to="/" replace />;
  }

  const sumShown = rows.reduce((a, r) => a + (r.closureValue ?? 0), 0);

  return (
    <PageTransition>
      <div className="p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <FileSearch className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("audit.title")}</h1>
            <p className="mt-1 text-sm text-gray-500">{t("audit.subtitle")}</p>
          </div>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={(e) => void runQuery(e, 1)}
          className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t("audit.filterAssignee")}</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="">{t("common.all")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t("audit.filterLeadType")}</label>
            <select
              value={leadTypeId}
              onChange={(e) => setLeadTypeId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="">{t("common.all")}</option>
              {leadTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t("audit.filterTeam")}</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="">{t("common.all")}</option>
              {teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t("audit.resolvedFrom")}</label>
            <input
              type="datetime-local"
              value={resolvedFrom}
              onChange={(e) => setResolvedFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t("audit.resolvedTo")}</label>
            <input
              type="datetime-local"
              value={resolvedTo}
              onChange={(e) => setResolvedTo(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full text-sm">
              {t("common.search")}
            </button>
          </div>
        </motion.form>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
          <span>
            {t("audit.totalRows")}: {total}
            {rows.length > 0 ? (
              <span className="ml-2 text-gray-500">
                ({t("audit.sumPage")}: {fmtMoney(sumShown)})
              </span>
            ) : null}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center text-sm text-gray-500">
            {t("audit.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">{t("audit.colWhen")}</th>
                  <th className="px-3 py-2">{t("audit.colContact")}</th>
                  <th className="px-3 py-2">{t("audit.colAssignee")}</th>
                  <th className="px-3 py-2">{t("audit.colTeam")}</th>
                  <th className="px-3 py-2">{t("audit.colLead")}</th>
                  <th className="px-3 py-2">{t("audit.colValue")}</th>
                  <th className="px-3 py-2">{t("audit.colContactMeta")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/80">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                      <span className="flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true, locale: dateLocale })}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {format(new Date(r.updatedAt), "Pp", { locale: dateLocale })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{r.contact.name}</p>
                      <p className="text-xs text-gray-500">{r.contact.phone}</p>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.assignedTo?.name ?? "—"}
                      <br />
                      <span className="text-[10px] text-gray-400">{r.assignedTo?.email}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.team?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.leadType ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ backgroundColor: r.leadType.color }}
                        >
                          {r.leadType.name}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {r.closureValue != null && r.closureValue > 0 ? fmtMoney(r.closureValue) : "—"}
                    </td>
                    <td className="max-w-[220px] px-3 py-2 text-xs text-gray-600">
                      <p>
                        <span className="font-medium text-gray-700">{t("audit.contactOwner")}:</span>{" "}
                        {r.contact.assignedTo?.name ?? "—"}
                      </p>
                      <p className="mt-0.5">
                        <span className="font-medium text-gray-700">{t("audit.contactCreatedBy")}:</span>{" "}
                        {r.contact.createdBy?.name ?? t("audit.sourceInbound")}
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        {t("audit.contactCreatedAt")}: {format(new Date(r.contact.createdAt), "P", { locale: dateLocale })}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to={`/conversations/${r.id}`}
                        className="text-xs font-medium text-brand-600 hover:text-brand-800"
                      >
                        {t("audit.open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > pageSize ? (
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              className="btn-secondary text-sm disabled:opacity-50"
              onClick={() => void runQuery(undefined, page - 1)}
            >
              {t("superAdmin.prev")}
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total || loading}
              className="btn-secondary text-sm disabled:opacity-50"
              onClick={() => void runQuery(undefined, page + 1)}
            >
              {t("superAdmin.next")}
            </button>
          </div>
        ) : null}
      </div>
    </PageTransition>
  );
}
