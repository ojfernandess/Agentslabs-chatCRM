import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Mail,
  MailOpen,
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
  Check,
  ArchiveRestore,
  Star,
  FolderInput,
  Inbox,
} from "lucide-react";
import { priorityIcon, type ConversationPriority } from "@/lib/conversationPriority";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";

export interface ConversationContextTarget {
  id: string;
  status: string;
  priority?: ConversationPriority | null;
  isUnread?: boolean;
  isStarred?: boolean;
  deletedAt?: string | null;
  contact: { id: string; name: string };
}

export type ConversationContextMenuUpdate = {
  id: string;
  status?: string;
  priority?: ConversationPriority | null;
  isUnread?: boolean;
  isStarred?: boolean;
  emailFolderId?: string | null;
};

interface ConversationContextMenuProps {
  target: ConversationContextTarget | null;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onUpdated: (update?: ConversationContextMenuUpdate) => void;
  onDeleted: (conversationId: string) => void;
  /** Caminho da conversa (ex.: workspace de e-mail). Por omissão `/conversations/:id`. */
  conversationPath?: (conversationId: string) => string;
  /** Pastas de e-mail para mover conversas (workspace de e-mail). */
  emailFolders?: { id: string; name: string }[];
}

type SubmenuKey = "priority" | "tags" | "agents" | "teams" | "emailFolders";
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
  conversationPath,
  emailFolders,
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
    window.addEventListener("click", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onPointer);
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
      window.dispatchEvent(
        new CustomEvent("openconduit:conversation-updated", { detail: { conversationId: target.id } }),
      );
      const update: ConversationContextMenuUpdate = { id: target.id };
      if (typeof body.status === "string") update.status = body.status;
      if (body.priority !== undefined) {
        update.priority = (body.priority as ConversationPriority | null) ?? null;
      }
      onUpdated(update);
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
      window.dispatchEvent(new CustomEvent("openconduit:team-transfer-badges-refresh"));
      window.dispatchEvent(
        new CustomEvent("openconduit:conversation-updated", { detail: { conversationId: target.id } }),
      );
      onUpdated({ id: target.id, isUnread: true });
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const markRead = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/conversations/${target.id}/read`);
      window.dispatchEvent(new CustomEvent("openconduit:team-transfer-badges-refresh"));
      window.dispatchEvent(
        new CustomEvent("openconduit:conversation-read", { detail: { conversationId: target.id } }),
      );
      onUpdated({ id: target.id, isUnread: false });
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
      onUpdated({ id: target.id });
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const deleteConversation = async () => {
    if (!target) return;
    const inTrash = Boolean(target.deletedAt);
    if (
      !window.confirm(
        inTrash
          ? t("conversations.contextMenu.deletePermanentConfirm")
          : t("conversations.contextMenu.deleteConfirm"),
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      if (inTrash) {
        await api.delete(`/conversations/${target.id}/permanent`);
      } else {
        await api.delete(`/conversations/${target.id}`);
      }
      onDeleted(target.id);
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const restoreConversation = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/conversations/${target.id}/restore`);
      window.dispatchEvent(
        new CustomEvent("openconduit:conversation-updated", { detail: { conversationId: target.id } }),
      );
      onUpdated({ id: target.id });
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const toggleStar = async () => {
    if (!target) return;
    const next = !target.isStarred;
    setBusy(true);
    try {
      await api.post(`/conversations/${target.id}/star`, { starred: next });
      onUpdated({ id: target.id, isStarred: next });
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const moveToEmailFolder = async (folderId: string | null) => {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/conversations/${target.id}/email-folder`, { folderId });
      onUpdated({ id: target.id, emailFolderId: folderId });
      onClose();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const pathFor = useCallback(
    (conversationId: string) =>
      conversationPath ? conversationPath(conversationId) : `/conversations/${conversationId}`,
    [conversationPath],
  );

  const copyLink = async () => {
    if (!target) return;
    const url = `${window.location.origin}${pathFor(target.id)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
    onClose();
  };

  const openNewTab = () => {
    if (!target) return;
    window.open(pathFor(target.id), "_blank", "noopener,noreferrer");
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
      {target.isUnread ? (
        <MenuItem
          icon={MailOpen}
          label={t("conversations.contextMenu.markRead")}
          disabled={busy}
          onClick={() => void markRead()}
        />
      ) : (
        <MenuItem
          icon={Mail}
          label={t("conversations.contextMenu.markUnread")}
          disabled={busy}
          onClick={() => void markUnread()}
        />
      )}
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

      {emailFolders ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={Star}
            label={
              target.isStarred
                ? t("inboxesPage.emailWorkspace.unstarEmail")
                : t("inboxesPage.emailWorkspace.starEmail")
            }
            disabled={busy}
            onClick={() => void toggleStar()}
          />
          <SubmenuRow
            icon={FolderInput}
            label={t("inboxesPage.emailWorkspace.moveToFolder")}
            open={openSub === "emailFolders"}
            disabled={busy}
            onEnter={() => setOpenSub("emailFolders")}
            onLeave={() => setOpenSub((s) => (s === "emailFolders" ? null : s))}
          >
            <MenuItem
              icon={Inbox}
              label={t("inboxesPage.emailWorkspace.folderInbox")}
              disabled={busy}
              onClick={() => void moveToEmailFolder(null)}
            />
            {emailFolders.map((folder) => (
              <MenuItem
                key={folder.id}
                icon={FolderInput}
                label={folder.name}
                disabled={busy}
                onClick={() => void moveToEmailFolder(folder.id)}
              />
            ))}
          </SubmenuRow>
        </>
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
          {PRIORITIES.map((p) => {
            const Icon = priorityIcon(p);
            const selected = target?.priority === p;
            return (
              <button
                key={p}
                type="button"
                className={itemClass}
                disabled={busy}
                onClick={() => void patchConversation({ priority: p })}
              >
                <Icon className="h-4 w-4 shrink-0 text-ink-500 dark:text-ink-400" />
                <span className="min-w-0 flex-1">{priorityLabel(p)}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" /> : null}
              </button>
            );
          })}
          <button
            type="button"
            className={itemClass}
            disabled={busy}
            onClick={() => void patchConversation({ priority: null })}
          >
            <span className="min-w-0 flex-1">{priorityLabel("NONE")}</span>
            {!target?.priority ? <Check className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" /> : null}
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

      <MenuSeparator />

      {target.deletedAt ? (
        <MenuItem
          icon={ArchiveRestore}
          label={t("conversations.contextMenu.restore")}
          disabled={busy}
          onClick={() => void restoreConversation()}
        />
      ) : (
        <MenuItem
          icon={Trash2}
          label={t("conversations.contextMenu.delete")}
          disabled={busy}
          onClick={() => void deleteConversation()}
          destructive
        />
      )}

      {isSuperAdmin && target.deletedAt ? (
        <MenuItem
          icon={Trash2}
          label={t("conversations.contextMenu.deletePermanent")}
          disabled={busy}
          onClick={() => void deleteConversation()}
          destructive
        />
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
      {open ? (
        <div
          className="absolute left-full top-0 z-10 -ml-1 pl-1"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
