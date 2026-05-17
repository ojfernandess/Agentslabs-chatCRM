import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Mail,
  RotateCcw,
  Clock,
  AlertTriangle,
  Tag,
  UserPlus,
  Users,
  ExternalLink,
  Copy,
  Trash2,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";

export interface ConversationContextTarget {
  id: string;
  status: string;
  contact: { id: string; name: string };
}

interface ConversationContextMenuProps {
  target: ConversationContextTarget | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: (conversationId: string) => void;
}

type SubmenuKey = "priority" | "tags" | "agents" | "teams";
type PriorityValue = (typeof PRIORITIES)[number] | "NONE";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;

const itemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-800 transition hover:bg-ink-100 disabled:opacity-50 dark:text-ink-100 dark:hover:bg-ink-800/80";

const flyoutClass =
  "rounded-xl border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-950";

export function ConversationContextMenu({
  target,
  position,
  onClose,
  onUpdated,
  onDeleted,
}: ConversationContextMenuProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [openSub, setOpenSub] = useState<SubmenuKey | null>(null);
  const [tags, setTags] = useState<{ id: string; name: string; color: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  useEffect(() => {
    if (!target || !position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: MouseEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [target, position, onClose]);

  const loadSubmenuData = useCallback(
    async (key: SubmenuKey) => {
      try {
        if (key === "tags" && tags.length === 0) {
          const rows = await api.get<{ id: string; name: string; color: string }[]>("/tags");
          setTags(rows);
        }
        if (key === "agents" && agents.length === 0) {
          const rows = await api.get<{ id: string; name: string }[]>("/users");
          setAgents(rows.map((u) => ({ id: u.id, name: u.name })));
        }
        if (key === "teams" && teams.length === 0) {
          const res = await api.get<{ data: { id: string; name: string }[] }>("/teams");
          setTeams(res.data.map((x) => ({ id: x.id, name: x.name })));
        }
      } catch {
        /* ignore */
      }
    },
    [tags.length, agents.length, teams.length],
  );

  const patchConversation = async (body: Record<string, unknown>) => {
    if (!target) return;
    setBusy(true);
    try {
      await api.put(`/conversations/${target.id}`, body);
      window.dispatchEvent(new CustomEvent("openconduit:conversation-updated"));
      onUpdated();
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const markUnread = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/conversations/${target.id}/unread`);
      onUpdated();
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const assignTag = async (tagId: string) => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/contacts/${target.contact.id}/tags`, { tagIds: [tagId] });
      onUpdated();
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = async () => {
    if (!target) return;
    if (!window.confirm(t("conversations.contextMenu.deleteConfirm"))) return;
    setBusy(true);
    try {
      await api.delete(`/conversations/${target.id}`);
      onDeleted(target.id);
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!target) return;
    const url = `${window.location.origin}/conversations/${target.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
    onClose();
  };

  const openNewTab = () => {
    if (!target) return;
    window.open(`/conversations/${target.id}`, "_blank", "noopener,noreferrer");
    onClose();
  };

  const priorityLabel = (p: PriorityValue) => {
    if (p === "NONE") return t("conversations.contextMenu.priorityNone");
    return t(`conversations.contextMenu.priority${p}` as "conversations.contextMenu.priorityLOW");
  };

  if (!target || !position) return null;

  const menuLeft = Math.min(position.x, window.innerWidth - 280);
  const menuTop = Math.min(position.y, window.innerHeight - 420);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[200] min-w-[240px] max-w-[280px] rounded-xl border border-ink-200 bg-white py-1.5 shadow-xl dark:border-ink-700 dark:bg-ink-950"
      style={{ left: menuLeft, top: menuTop }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        icon={Mail}
        label={t("conversations.contextMenu.markUnread")}
        disabled={busy}
        onClick={() => void markUnread()}
      />
      {target.status === "RESOLVED" ? (
        <MenuItem
          icon={RotateCcw}
          label={t("conversations.contextMenu.reopen")}
          disabled={busy}
          onClick={() => void patchConversation({ status: "OPEN" })}
        />
      ) : null}
      {target.status !== "PENDING" ? (
        <MenuItem
          icon={Clock}
          label={t("conversations.contextMenu.leavePending")}
          disabled={busy}
          onClick={() => void patchConversation({ status: "PENDING" })}
        />
      ) : null}

      <MenuSeparator />

      <SubmenuRow
        icon={AlertTriangle}
        label={t("conversations.contextMenu.priority")}
        open={openSub === "priority"}
        disabled={busy}
        onEnter={() => setOpenSub("priority")}
        onLeave={() => setOpenSub((s) => (s === "priority" ? null : s))}
      >
        <div className={clsx(flyoutClass, "min-w-[160px]")}>
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={itemClass}
              disabled={busy}
              onClick={() => void patchConversation({ priority: p })}
            >
              {priorityLabel(p)}
            </button>
          ))}
          <button
            type="button"
            className={itemClass}
            disabled={busy}
            onClick={() => void patchConversation({ priority: null })}
          >
            {priorityLabel("NONE")}
          </button>
        </div>
      </SubmenuRow>

      <SubmenuRow
        icon={Tag}
        label={t("conversations.contextMenu.assignTag")}
        open={openSub === "tags"}
        disabled={busy}
        onEnter={() => {
          setOpenSub("tags");
          void loadSubmenuData("tags");
        }}
        onLeave={() => setOpenSub((s) => (s === "tags" ? null : s))}
      >
        <div className={clsx(flyoutClass, "max-h-56 min-w-[180px] overflow-y-auto")}>
          {tags.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-500">{t("conversations.contextMenu.loading")}</p>
          ) : (
            tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={itemClass}
                disabled={busy}
                onClick={() => void assignTag(tag.id)}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                <span className="truncate">{tag.name}</span>
              </button>
            ))
          )}
        </div>
      </SubmenuRow>

      <SubmenuRow
        icon={UserPlus}
        label={t("conversations.contextMenu.assignAgent")}
        open={openSub === "agents"}
        disabled={busy}
        onEnter={() => {
          setOpenSub("agents");
          void loadSubmenuData("agents");
        }}
        onLeave={() => setOpenSub((s) => (s === "agents" ? null : s))}
      >
        <div className={clsx(flyoutClass, "max-h-56 min-w-[180px] overflow-y-auto")}>
          <button
            type="button"
            className={itemClass}
            disabled={busy}
            onClick={() => void patchConversation({ assignedToId: null })}
          >
            {t("conversations.contextMenu.unassigned")}
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              className={itemClass}
              disabled={busy}
              onClick={() => void patchConversation({ assignedToId: a.id })}
            >
              <span className="truncate">{a.name}</span>
            </button>
          ))}
        </div>
      </SubmenuRow>

      <SubmenuRow
        icon={Users}
        label={t("conversations.contextMenu.assignTeam")}
        open={openSub === "teams"}
        disabled={busy}
        onEnter={() => {
          setOpenSub("teams");
          void loadSubmenuData("teams");
        }}
        onLeave={() => setOpenSub((s) => (s === "teams" ? null : s))}
      >
        <div className={clsx(flyoutClass, "max-h-56 min-w-[180px] overflow-y-auto")}>
          <button
            type="button"
            className={itemClass}
            disabled={busy}
            onClick={() => void patchConversation({ teamId: null })}
          >
            {t("conversations.contextMenu.noTeam")}
          </button>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              className={itemClass}
              disabled={busy}
              onClick={() => void patchConversation({ teamId: team.id })}
            >
              <span className="truncate">{team.name}</span>
            </button>
          ))}
        </div>
      </SubmenuRow>

      <MenuSeparator />

      <MenuItem
        icon={ExternalLink}
        label={t("conversations.contextMenu.openNewTab")}
        disabled={busy}
        onClick={openNewTab}
      />
      <MenuItem icon={Copy} label={t("conversations.contextMenu.copyLink")} disabled={busy} onClick={() => void copyLink()} />

      {isSuperAdmin ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            label={t("conversations.contextMenu.delete")}
            disabled={busy}
            onClick={() => void deleteConversation()}
            destructive
          />
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function MenuSeparator() {
  return <div className="my-1 border-t border-ink-100 dark:border-ink-800" role="separator" />;
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={clsx(
        itemClass,
        destructive && "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0 text-ink-500 dark:text-ink-400" />
      <span className="flex-1">{label}</span>
    </button>
  );
}

function SubmenuRow({
  icon: Icon,
  label,
  open,
  disabled,
  onEnter,
  onLeave,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  open: boolean;
  disabled?: boolean;
  onEnter: () => void;
  onLeave: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button type="button" role="menuitem" className={itemClass} disabled={disabled} aria-haspopup="true">
        <Icon className="h-4 w-4 shrink-0 text-ink-500 dark:text-ink-400" />
        <span className="flex-1">{label}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
      </button>
      {open ? <div className="absolute left-full top-0 z-10 ml-0.5 pl-1">{children}</div> : null}
    </div>
  );
}
