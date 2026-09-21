import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  LayoutGrid,
  MessageCircle,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { WhatsAppBrandIcon } from "@/components/WhatsAppBrandIcon";
import {
  SuperAdminMetricCard,
  SuperAdminPageHeader,
  SuperAdminPanel,
} from "@/components/super-admin/SuperAdminShell";

export type SuperAdminOrgRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  planTier?: string;
  billingEmail?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  address?: string | null;
  cnpj?: string | null;
  monthlyMessageQuota?: number | null;
  aiBillingMode?: "OWN_API_KEY" | "PLATFORM_CREDITS";
  subscription?: {
    planId: string | null;
    status: string;
    plan: {
      id: string;
      name: string;
      slug: string;
      legacyPlanTier: string | null;
      isCustom: boolean;
    } | null;
  } | null;
  _count: { users: number; contacts: number; conversations: number };
};

export type SuperAdminOrgStats = {
  organizationTotal: number;
  organizationActive: number;
  organizationSuspended: number;
  userTotal: number;
  contactTotal: number;
  conversationOpen: number | null;
};

type PlanFilter = "all" | string;
type StatusFilter = "all" | "active" | "suspended";
type IntegrationFilter = "all" | "whatsapp";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-brand-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-sky-500",
  "bg-rose-500",
] as const;

function orgAvatarColor(name: string): (typeof AVATAR_COLORS)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function orgInitial(name: string): string {
  const trimmed = name.trim();
  return (trimmed[0] ?? "?").toUpperCase();
}

function orgPlanLabel(o: SuperAdminOrgRow): string {
  return o.subscription?.plan?.name ?? o.planTier ?? "free";
}

function planBadgeClass(planName: string, isCustom: boolean): string {
  if (isCustom) return "bg-amber-50 text-amber-800 ring-amber-200/80";
  const lower = planName.toLowerCase();
  if (lower.includes("enterprise")) return "bg-violet-50 text-violet-800 ring-violet-200/80";
  if (lower.includes("free")) return "bg-sky-50 text-sky-800 ring-sky-200/80";
  if (lower.includes("growth") || lower.includes("essencial")) return "bg-orange-50 text-orange-800 ring-orange-200/80";
  return "bg-slate-50 text-slate-700 ring-slate-200/80";
}

function matchesSearch(o: SuperAdminOrgRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const plan = orgPlanLabel(o).toLowerCase();
  return o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q) || plan.includes(q);
}

export type SuperAdminOrganizationsSectionProps = {
  orgs: SuperAdminOrgRow[];
  stats: SuperAdminOrgStats | null;
  loading: boolean;
  name: string;
  slug: string;
  submitting: boolean;
  enteringId: string | null;
  copiedId: string | null;
  orgHasCustomPlan: (o: SuperAdminOrgRow) => boolean;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onCreate: (e: FormEvent) => boolean | Promise<boolean>;
  onToggleActive: (id: string, current: boolean) => void | Promise<void>;
  onCopyWebhook: (orgId: string) => void | Promise<void>;
  webhookUrlFor: (orgId: string) => string;
  onEnterOrg: (id: string) => void | Promise<void>;
  onEditOrg: (o: SuperAdminOrgRow) => void;
  onDeleteOrg: (o: SuperAdminOrgRow) => void;
  onOpenFeatures: (orgId: string) => void;
  onExportOrg: (o: SuperAdminOrgRow) => void;
  onOpenBilling: (o: SuperAdminOrgRow) => void;
  onOpenUsers: (o: SuperAdminOrgRow) => void;
};

function isAnchorVisible(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function computeOrgMenuPosition(
  anchor: HTMLElement,
  panel: HTMLDivElement | null,
): { top: number; left: number } {
  const rect = anchor.getBoundingClientRect();
  const gap = 4;
  const viewportPad = 8;
  const panelWidth = panel?.offsetWidth ?? 224;
  const top = rect.bottom + gap;
  let left = rect.right - panelWidth;
  left = Math.max(viewportPad, Math.min(left, window.innerWidth - panelWidth - viewportPad));
  return { top, left };
}

function OrgActionsMenu({
  org,
  open,
  onToggle,
  onClose,
  onEditOrg,
  onOpenBilling,
  onOpenUsers,
  onOpenFeatures,
  onCopyWebhook,
  onExportOrg,
  onDeleteOrg,
}: {
  org: SuperAdminOrgRow;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEditOrg: (o: SuperAdminOrgRow) => void;
  onOpenBilling: (o: SuperAdminOrgRow) => void;
  onOpenUsers: (o: SuperAdminOrgRow) => void;
  onOpenFeatures: (orgId: string) => void;
  onCopyWebhook: (orgId: string) => void | Promise<void>;
  onExportOrg: (o: SuperAdminOrgRow) => void;
  onDeleteOrg: (o: SuperAdminOrgRow) => void;
}) {
  const { t } = useI18n();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPosition = useCallback(() => {
    const anchor = toggleRef.current;
    if (!anchor || !isAnchorVisible(anchor)) {
      setMenuPos(null);
      return;
    }
    setMenuPos(computeOrgMenuPosition(anchor, menuRef.current));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onReposition = () => updateMenuPosition();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open || !menuPos) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toggleRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, menuPos, onClose]);

  useEffect(() => {
    const panel = menuRef.current;
    if (!open || !panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateMenuPosition());
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, updateMenuPosition]);

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800";

  const runMenuAction = (action: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    action();
    onClose();
  };

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[120] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
            style={{ top: menuPos.top, left: menuPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button type="button" role="menuitem" className={itemClass} onClick={runMenuAction(() => onEditOrg(org))}>
              <Pencil className="h-4 w-4 shrink-0 text-slate-400" />
              {t("superAdmin.orgMenuEdit")}
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={runMenuAction(() => onOpenBilling(org))}>
              <LayoutGrid className="h-4 w-4 shrink-0 text-slate-400" />
              {t("superAdmin.orgMenuBilling")}
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={runMenuAction(() => onOpenUsers(org))}>
              <Users className="h-4 w-4 shrink-0 text-slate-400" />
              {t("superAdmin.orgMenuUsers")}
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={runMenuAction(() => onOpenFeatures(org.id))}>
              <LayoutGrid className="h-4 w-4 shrink-0 text-slate-400" />
              {t("superAdmin.orgOpenFeatures")}
            </button>
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={runMenuAction(() => void onCopyWebhook(org.id))}
            >
              <Copy className="h-4 w-4 shrink-0 text-slate-400" />
              {t("superAdmin.orgMenuIntegrations")}
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={runMenuAction(() => onExportOrg(org))}>
              <Download className="h-4 w-4 shrink-0 text-slate-400" />
              {t("superAdmin.orgExportAction")}
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={runMenuAction(() => onDeleteOrg(org))}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {t("superAdmin.orgMenuDelete")}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        aria-label={t("superAdmin.orgTableActions")}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menu}
    </>
  );
}

function CreateOrganizationDrawer({
  open,
  onClose,
  name,
  slug,
  submitting,
  onNameChange,
  onSlugChange,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  slug: string;
  submitting: boolean;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onCreate: (e: FormEvent) => boolean | Promise<boolean>;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    const ok = await onCreate(e);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-create-drawer-title"
        className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <h2 id="org-create-drawer-title" className="text-lg font-semibold text-slate-900">
              {t("superAdmin.orgNewOrganization")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{t("superAdmin.orgCreateHint")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-1 flex-col overflow-auto px-6 py-5">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.orgCreateName")}</label>
              <input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="input-field mt-1 w-full"
                placeholder={t("superAdmin.orgCreateNamePlaceholder")}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">{t("superAdmin.orgCreateSlug")}</label>
              <input
                value={slug}
                onChange={(e) => onSlugChange(e.target.value)}
                className="input-field mt-1 w-full"
                placeholder={t("superAdmin.orgCreateSlugPlaceholder")}
              />
            </div>
          </div>
          <div className="mt-auto flex gap-2 border-t border-slate-100 pt-5">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1">
              {submitting ? t("superAdmin.orgCreateSubmitting") : t("superAdmin.orgCreateSubmit")}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function OrgUsageCell({ org }: { org: SuperAdminOrgRow }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1 text-sm text-slate-600">
      <div className="flex items-center gap-2">
        <UserCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>{t("superAdmin.orgUsageUsers").replace("{count}", String(org._count.users))}</span>
      </div>
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>{t("superAdmin.orgUsageContacts").replace("{count}", String(org._count.contacts))}</span>
      </div>
      <div className="flex items-center gap-2">
        <MessageCircle className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span>{t("superAdmin.orgUsageConversations").replace("{count}", String(org._count.conversations))}</span>
      </div>
    </div>
  );
}

function OrgIntegrationsCell({
  org,
  copiedId,
  webhookUrlFor,
  onCopyWebhook,
}: {
  org: SuperAdminOrgRow;
  copiedId: string | null;
  webhookUrlFor: (orgId: string) => string;
  onCopyWebhook: (orgId: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const url = webhookUrlFor(org.id);
  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200/80">
        <WhatsAppBrandIcon className="h-3.5 w-3.5" />
        WhatsApp
      </div>
      <div className="flex items-center gap-1">
        <code className="max-w-[160px] truncate font-mono text-[11px] text-slate-500" title={url}>
          {url}
        </code>
        <button
          type="button"
          onClick={() => void onCopyWebhook(org.id)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title={t("superAdmin.orgCopyWebhook")}
          aria-label={t("superAdmin.orgCopyWebhook")}
        >
          {copiedId === org.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function OrgRowActions({
  org,
  enteringId,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onEnterOrg,
  onEditOrg,
  onOpenBilling,
  onOpenUsers,
  onOpenFeatures,
  onCopyWebhook,
  onExportOrg,
  onDeleteOrg,
}: {
  org: SuperAdminOrgRow;
  enteringId: string | null;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onEnterOrg: (id: string) => void | Promise<void>;
  onEditOrg: (o: SuperAdminOrgRow) => void;
  onOpenBilling: (o: SuperAdminOrgRow) => void;
  onOpenUsers: (o: SuperAdminOrgRow) => void;
  onOpenFeatures: (orgId: string) => void;
  onCopyWebhook: (orgId: string) => void | Promise<void>;
  onExportOrg: (o: SuperAdminOrgRow) => void;
  onDeleteOrg: (o: SuperAdminOrgRow) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        disabled={!org.isActive || enteringId === org.id}
        onClick={() => void onEnterOrg(org.id)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        {enteringId === org.id ? t("superAdmin.orgEntering") : t("superAdmin.orgEnter")}
      </button>
      <OrgActionsMenu
        org={org}
        open={menuOpen}
        onToggle={onMenuToggle}
        onClose={onMenuClose}
        onEditOrg={onEditOrg}
        onOpenBilling={onOpenBilling}
        onOpenUsers={onOpenUsers}
        onOpenFeatures={onOpenFeatures}
        onCopyWebhook={onCopyWebhook}
        onExportOrg={onExportOrg}
        onDeleteOrg={onDeleteOrg}
      />
    </div>
  );
}

export function SuperAdminOrganizationsSection({
  orgs,
  stats,
  loading,
  name,
  slug,
  submitting,
  enteringId,
  copiedId,
  orgHasCustomPlan,
  onNameChange,
  onSlugChange,
  onCreate,
  onToggleActive,
  onCopyWebhook,
  webhookUrlFor,
  onEnterOrg,
  onEditOrg,
  onDeleteOrg,
  onOpenFeatures,
  onExportOrg,
  onOpenBilling,
  onOpenUsers,
}: SuperAdminOrganizationsSectionProps) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [integrationFilter, setIntegrationFilter] = useState<IntegrationFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [openMenuOrgId, setOpenMenuOrgId] = useState<string | null>(null);

  const totalConversations = useMemo(
    () => orgs.reduce((sum, o) => sum + o._count.conversations, 0),
    [orgs],
  );

  const planOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const o of orgs) labels.add(orgPlanLabel(o));
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [orgs]);

  const filteredOrgs = useMemo(() => {
    return orgs.filter((o) => {
      if (!matchesSearch(o, searchQuery)) return false;
      if (planFilter !== "all" && orgPlanLabel(o) !== planFilter) return false;
      if (statusFilter === "active" && !o.isActive) return false;
      if (statusFilter === "suspended" && o.isActive) return false;
      if (integrationFilter === "whatsapp") return true;
      return true;
    });
  }, [orgs, searchQuery, planFilter, statusFilter, integrationFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrgs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedOrgs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrgs.slice(start, start + pageSize);
  }, [filteredOrgs, currentPage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, planFilter, statusFilter, integrationFilter, pageSize]);

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setPlanFilter("all");
    setStatusFilter("all");
    setIntegrationFilter("all");
    setPage(1);
  }, []);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    planFilter !== "all" ||
    statusFilter !== "all" ||
    integrationFilter !== "all";

  const paginationFrom = filteredOrgs.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const paginationTo = Math.min(currentPage * pageSize, filteredOrgs.length);

  const activeHint =
    stats && stats.organizationSuspended > 0
      ? t("superAdmin.organizationsStatSuspendedHint").replace("{count}", String(stats.organizationSuspended))
      : undefined;

  const headerAction = (
    <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary inline-flex items-center gap-2">
      <Plus className="h-4 w-4" />
      {t("superAdmin.orgNewOrganization")}
    </button>
  );

  const renderPlanCell = (o: SuperAdminOrgRow) => {
    const planName = orgPlanLabel(o);
    const isCustom = orgHasCustomPlan(o);
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={clsx(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
              planBadgeClass(planName, isCustom),
            )}
          >
            {planName}
          </span>
          {isCustom ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
              {t("superAdmin.planCustomBadge")}
            </span>
          ) : null}
        </div>
        {o.subscription?.status ? <p className="text-xs text-slate-500">{o.subscription.status}</p> : null}
      </div>
    );
  };

  const renderStatusCell = (o: SuperAdminOrgRow) => (
    <button
      type="button"
      onClick={() => void onToggleActive(o.id, o.isActive)}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90",
        o.isActive
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80"
          : "bg-slate-100 text-slate-600 ring-1 ring-slate-200/80",
      )}
      title={o.isActive ? t("superAdmin.orgStatusActive") : t("superAdmin.orgStatusSuspended")}
    >
      <span className={clsx("h-2 w-2 rounded-full", o.isActive ? "bg-emerald-500" : "bg-slate-400")} />
      {o.isActive ? t("superAdmin.orgStatusActive") : t("superAdmin.orgStatusSuspended")}
    </button>
  );

  const renderOrgIdentity = (o: SuperAdminOrgRow) => (
    <div className="flex items-start gap-3">
      <div
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm",
          orgAvatarColor(o.name),
        )}
        aria-hidden
      >
        {orgInitial(o.name)}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{o.name}</p>
        <p className="truncate text-sm text-slate-500">{o.slug}</p>
      </div>
    </div>
  );

  const emptyContent = (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
        <Building2 className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-slate-900">
        {hasActiveFilters ? t("superAdmin.orgEmptyFiltered") : t("superAdmin.orgEmpty")}
      </p>
      {hasActiveFilters ? (
        <p className="mt-1 max-w-md text-sm text-slate-500">{t("superAdmin.orgEmptyFilteredHint")}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {hasActiveFilters ? (
          <button type="button" onClick={clearFilters} className="btn-secondary inline-flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            {t("superAdmin.orgClearFilters")}
          </button>
        ) : null}
        <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {t("superAdmin.orgNewOrganization")}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <SuperAdminPageHeader
        icon={
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/20">
            <Building2 className="h-5 w-5" />
          </div>
        }
        title={t("superAdmin.organizations")}
        subtitle={t("superAdmin.organizationsSubtitle")}
        actions={headerAction}
      />

      {stats && !loading ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SuperAdminMetricCard
            label={t("superAdmin.organizationsStatTotal")}
            value={stats.organizationTotal}
            accent="violet"
          />
          <SuperAdminMetricCard
            label={t("superAdmin.organizationsStatActive")}
            value={stats.organizationActive}
            hint={activeHint}
            accent="emerald"
          />
          <SuperAdminMetricCard
            label={t("superAdmin.organizationsStatUsers")}
            value={stats.userTotal}
            accent="default"
          />
          <SuperAdminMetricCard
            label={t("superAdmin.organizationsStatConversations")}
            value={totalConversations}
            accent="violet"
          />
        </div>
      ) : null}

      <SuperAdminPanel>
        <div className="border-b border-slate-100 p-4 lg:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("superAdmin.orgSearchPlaceholder")}
                className="input-field w-full pl-10"
                aria-label={t("superAdmin.orgSearchPlaceholder")}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="input-field min-w-[150px]"
                aria-label={t("superAdmin.orgFilterAllPlans")}
              >
                <option value="all">{t("superAdmin.orgFilterAllPlans")}</option>
                {planOptions.map((plan) => (
                  <option key={plan} value={plan}>
                    {plan}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="input-field min-w-[140px]"
                aria-label={t("superAdmin.orgFilterAllStatus")}
              >
                <option value="all">{t("superAdmin.orgFilterAllStatus")}</option>
                <option value="active">{t("superAdmin.orgFilterActive")}</option>
                <option value="suspended">{t("superAdmin.orgFilterSuspended")}</option>
              </select>
              <select
                value={integrationFilter}
                onChange={(e) => setIntegrationFilter(e.target.value as IntegrationFilter)}
                className="input-field min-w-[170px]"
                aria-label={t("superAdmin.orgFilterAllIntegrations")}
              >
                <option value="all">{t("superAdmin.orgFilterAllIntegrations")}</option>
                <option value="whatsapp">{t("superAdmin.orgFilterWhatsApp")}</option>
              </select>
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                {t("superAdmin.orgClearFilters")}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-sm text-slate-500">{t("common.loading")}</div>
        ) : filteredOrgs.length === 0 ? (
          emptyContent
        ) : (
          <>
            <div className="hidden lg:block">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50/80">
                    <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3">{t("superAdmin.orgTableOrganization")}</th>
                      <th className="px-4 py-3">{t("superAdmin.orgTablePlan")}</th>
                      <th className="px-4 py-3">{t("superAdmin.orgTableUsage")}</th>
                      <th className="px-4 py-3">{t("superAdmin.orgTableStatus")}</th>
                      <th className="hidden xl:table-cell px-4 py-3">{t("superAdmin.orgTableIntegrations")}</th>
                      <th className="px-5 py-3 text-right">{t("superAdmin.orgTableActions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedOrgs.map((o) => (
                      <tr key={o.id} className="transition-colors hover:bg-slate-50/60">
                        <td className="px-5 py-4">{renderOrgIdentity(o)}</td>
                        <td className="px-4 py-4">{renderPlanCell(o)}</td>
                        <td className="px-4 py-4">
                          <OrgUsageCell org={o} />
                        </td>
                        <td className="px-4 py-4">{renderStatusCell(o)}</td>
                        <td className="hidden xl:table-cell px-4 py-4">
                          <OrgIntegrationsCell
                            org={o}
                            copiedId={copiedId}
                            webhookUrlFor={webhookUrlFor}
                            onCopyWebhook={onCopyWebhook}
                          />
                        </td>
                        <td className="relative px-5 py-4">
                          <OrgRowActions
                            org={o}
                            enteringId={enteringId}
                            menuOpen={openMenuOrgId === o.id}
                            onMenuToggle={() => setOpenMenuOrgId((prev) => (prev === o.id ? null : o.id))}
                            onMenuClose={() => setOpenMenuOrgId(null)}
                            onEnterOrg={onEnterOrg}
                            onEditOrg={onEditOrg}
                            onOpenBilling={onOpenBilling}
                            onOpenUsers={onOpenUsers}
                            onOpenFeatures={onOpenFeatures}
                            onCopyWebhook={onCopyWebhook}
                            onExportOrg={onExportOrg}
                            onDeleteOrg={onDeleteOrg}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 p-4 lg:hidden">
              {paginatedOrgs.map((o) => (
                <div key={o.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  {renderOrgIdentity(o)}
                  <div className="mt-4 space-y-3">
                    {renderPlanCell(o)}
                    <OrgUsageCell org={o} />
                    {renderStatusCell(o)}
                    <OrgIntegrationsCell
                      org={o}
                      copiedId={copiedId}
                      webhookUrlFor={webhookUrlFor}
                      onCopyWebhook={onCopyWebhook}
                    />
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <OrgRowActions
                      org={o}
                      enteringId={enteringId}
                      menuOpen={openMenuOrgId === o.id}
                      onMenuToggle={() => setOpenMenuOrgId((prev) => (prev === o.id ? null : o.id))}
                      onMenuClose={() => setOpenMenuOrgId(null)}
                      onEnterOrg={onEnterOrg}
                      onEditOrg={onEditOrg}
                      onOpenBilling={onOpenBilling}
                      onOpenUsers={onOpenUsers}
                      onOpenFeatures={onOpenFeatures}
                      onCopyWebhook={onCopyWebhook}
                      onExportOrg={onExportOrg}
                      onDeleteOrg={onDeleteOrg}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-5">
              <p className="text-sm text-slate-500">
                {t("superAdmin.orgPaginationShowing")
                  .replace("{from}", String(paginationFrom))
                  .replace("{to}", String(paginationTo))
                  .replace("{total}", String(filteredOrgs.length))}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                  aria-label={t("superAdmin.orgPaginationPrevious")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[2rem] text-center text-sm font-medium text-slate-700">{currentPage}</span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                  aria-label={t("superAdmin.orgPaginationNext")}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                  className="input-field ml-1 min-w-[130px]"
                  aria-label={t("superAdmin.orgPaginationPerPage")}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {t("superAdmin.orgPaginationPerPage").replace("{count}", String(size))}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </SuperAdminPanel>

      <CreateOrganizationDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        name={name}
        slug={slug}
        submitting={submitting}
        onNameChange={onNameChange}
        onSlugChange={onSlugChange}
        onCreate={onCreate}
      />
    </>
  );
}
