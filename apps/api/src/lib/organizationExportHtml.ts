import type { OrganizationExportData } from "./organizationDataExport.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function buildOrganizationExportHtml(data: OrganizationExportData): Buffer {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  const orgName = escapeHtml(data.organization.name);
  const exportedAt = escapeHtml(formatDateTime(data.exportedAt));

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exportação ${orgName} — OpenNexo CRM</title>
  <style>
    :root {
      --wa-sidebar: #111b21;
      --wa-sidebar-hover: #202c33;
      --wa-sidebar-border: #222d34;
      --wa-chat-bg: #0b141a;
      --wa-panel-bg: #efeae2;
      --wa-bubble-in: #ffffff;
      --wa-bubble-out: #d9fdd3;
      --wa-text: #111b21;
      --wa-muted: #667781;
      --wa-search: #202c33;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: var(--wa-chat-bg); color: #e9edef; }
    .app { display: flex; height: 100vh; overflow: hidden; }
    .sidebar { width: 380px; min-width: 300px; max-width: 42vw; background: var(--wa-sidebar); border-right: 1px solid var(--wa-sidebar-border); display: flex; flex-direction: column; }
    .sidebar-header { padding: 16px 18px 10px; background: var(--wa-sidebar); border-bottom: 1px solid var(--wa-sidebar-border); }
    .sidebar-header h1 { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #e9edef; }
    .sidebar-header p { margin: 0; font-size: 12px; color: var(--wa-muted); }
    .search-wrap { padding: 10px 14px 12px; background: var(--wa-sidebar); border-bottom: 1px solid var(--wa-sidebar-border); }
    .search-wrap input { width: 100%; border: none; border-radius: 8px; background: var(--wa-search); color: #e9edef; padding: 10px 14px; font-size: 14px; outline: none; }
    .search-wrap input::placeholder { color: #8696a0; }
    .conv-list { flex: 1; overflow-y: auto; }
    .conv-item { display: flex; gap: 12px; padding: 12px 16px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s; }
    .conv-item:hover, .conv-item.active { background: var(--wa-sidebar-hover); }
    .avatar { width: 48px; height: 48px; border-radius: 50%; background: #54656f; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; flex-shrink: 0; }
    .conv-meta { min-width: 0; flex: 1; }
    .conv-top { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
    .conv-name { font-size: 16px; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .conv-time { font-size: 12px; color: #8696a0; flex-shrink: 0; }
    .conv-preview { font-size: 13px; color: #8696a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .conv-sub { font-size: 11px; color: #667781; margin-top: 2px; }
    .chat { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--wa-panel-bg); background-image: radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px); background-size: 18px 18px; }
    .chat-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--wa-muted); font-size: 15px; padding: 24px; text-align: center; }
    .chat-header { display: none; align-items: center; gap: 12px; padding: 10px 16px; background: #f0f2f5; border-bottom: 1px solid #d1d7db; color: var(--wa-text); }
    .chat-header.visible { display: flex; }
    .chat-header .avatar { width: 40px; height: 40px; font-size: 13px; }
    .chat-header h2 { margin: 0; font-size: 16px; font-weight: 500; }
    .chat-header p { margin: 2px 0 0; font-size: 12px; color: var(--wa-muted); }
    .messages { flex: 1; overflow-y: auto; padding: 18px 8%; display: none; flex-direction: column; gap: 6px; }
    .messages.visible { display: flex; }
    .day-sep { align-self: center; background: rgba(255,255,255,0.92); color: #54656f; font-size: 12px; padding: 5px 12px; border-radius: 8px; margin: 8px 0; box-shadow: 0 1px 0 rgba(0,0,0,0.06); }
    .bubble-row { display: flex; width: 100%; }
    .bubble-row.inbound { justify-content: flex-start; }
    .bubble-row.outbound { justify-content: flex-end; }
    .bubble { max-width: min(72%, 640px); padding: 6px 8px 8px 9px; border-radius: 8px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); position: relative; word-wrap: break-word; white-space: pre-wrap; font-size: 14.2px; line-height: 19px; color: var(--wa-text); }
    .bubble.inbound { background: var(--wa-bubble-in); border-top-left-radius: 0; }
    .bubble.outbound { background: var(--wa-bubble-out); border-top-right-radius: 0; }
    .bubble .time { display: block; text-align: right; font-size: 11px; color: #667781; margin-top: 4px; }
    .bubble .meta { font-size: 11px; color: #8696a0; margin-bottom: 4px; }
    .stats { padding: 8px 16px 12px; font-size: 11px; color: #8696a0; border-top: 1px solid var(--wa-sidebar-border); }
    @media (max-width: 900px) {
      .app { flex-direction: column; }
      .sidebar { width: 100%; max-width: none; height: 46vh; }
      .chat { height: 54vh; }
      .messages { padding: 14px 4%; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h1>${orgName}</h1>
        <p>Exportado em ${exportedAt} · OpenNexo CRM</p>
      </div>
      <div class="search-wrap">
        <input id="search" type="search" placeholder="Pesquisar conversas, contactos ou mensagens…" autocomplete="off" />
      </div>
      <div id="conv-list" class="conv-list"></div>
      <div id="stats" class="stats"></div>
    </aside>
    <section class="chat">
      <div id="chat-empty" class="chat-empty">Seleccione uma conversa para visualizar as mensagens.</div>
      <header id="chat-header" class="chat-header">
        <div id="chat-avatar" class="avatar"></div>
        <div>
          <h2 id="chat-title"></h2>
          <p id="chat-subtitle"></p>
        </div>
      </header>
      <div id="messages" class="messages"></div>
    </section>
  </div>
  <script>
    const DATA = ${payload};

    function initials(name) {
      const parts = String(name || "").trim().split(/\\s+/).filter(Boolean);
      if (!parts.length) return "?";
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function formatTime(iso) {
      try {
        return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      } catch { return iso; }
    }

    function formatDay(iso) {
      try {
        return new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
      } catch { return iso; }
    }

    function preview(body, type) {
      const text = (body || "").trim();
      if (text) return text.length > 80 ? text.slice(0, 80) + "…" : text;
      if (type !== "TEXT") return "[" + type + "]";
      return "";
    }

    const messagesByConversation = new Map();
    for (const msg of DATA.messages) {
      if (!messagesByConversation.has(msg.conversationId)) messagesByConversation.set(msg.conversationId, []);
      messagesByConversation.get(msg.conversationId).push(msg);
    }

    const conversationViews = DATA.conversations.map((conv) => {
      const msgs = messagesByConversation.get(conv.id) || [];
      const last = msgs[msgs.length - 1];
      return {
        ...conv,
        messages: msgs,
        searchText: [
          conv.contact.name,
          conv.contact.phone,
          conv.contact.email || "",
          conv.inbox?.name || "",
          conv.inbox?.channelType || "",
          conv.status,
          ...msgs.map((m) => [m.body || "", m.type, m.actorName || ""].join(" ")),
        ].join(" ").toLowerCase(),
        preview: last ? preview(last.body, last.type) : "Sem mensagens",
        lastAt: last?.sentAt || conv.updatedAt,
      };
    }).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

    const listEl = document.getElementById("conv-list");
    const statsEl = document.getElementById("stats");
    const searchEl = document.getElementById("search");
    const chatEmpty = document.getElementById("chat-empty");
    const chatHeader = document.getElementById("chat-header");
    const chatTitle = document.getElementById("chat-title");
    const chatSubtitle = document.getElementById("chat-subtitle");
    const chatAvatar = document.getElementById("chat-avatar");
    const messagesEl = document.getElementById("messages");

    let activeId = null;
    let filtered = conversationViews;

    function renderStats() {
      statsEl.textContent = filtered.length + " conversas · " + DATA.contacts.length + " contactos · " + DATA.messages.length + " mensagens";
    }

    function renderList() {
      listEl.innerHTML = "";
      if (!filtered.length) {
        listEl.innerHTML = '<div class="chat-empty" style="color:#8696a0;padding:24px;">Nenhuma conversa encontrada.</div>';
        renderStats();
        return;
      }
      for (const conv of filtered) {
        const item = document.createElement("div");
        item.className = "conv-item" + (conv.id === activeId ? " active" : "");
        item.dataset.id = conv.id;
        item.innerHTML =
          '<div class="avatar">' + initials(conv.contact.name) + '</div>' +
          '<div class="conv-meta">' +
            '<div class="conv-top"><div class="conv-name">' + conv.contact.name + '</div><div class="conv-time">' + formatTime(conv.lastAt) + '</div></div>' +
            '<div class="conv-preview">' + conv.preview + '</div>' +
            '<div class="conv-sub">' + conv.contact.phone + (conv.inbox?.name ? " · " + conv.inbox.name : "") + '</div>' +
          '</div>';
        item.addEventListener("click", () => selectConversation(conv.id));
        listEl.appendChild(item);
      }
      renderStats();
    }

    function renderMessages(conv) {
      messagesEl.innerHTML = "";
      let lastDay = "";
      for (const msg of conv.messages) {
        const day = formatDay(msg.sentAt);
        if (day !== lastDay) {
          lastDay = day;
          const sep = document.createElement("div");
          sep.className = "day-sep";
          sep.textContent = day;
          messagesEl.appendChild(sep);
        }
        const row = document.createElement("div");
        row.className = "bubble-row " + (msg.direction === "INBOUND" ? "inbound" : "outbound");
        const bubble = document.createElement("div");
        bubble.className = "bubble " + (msg.direction === "INBOUND" ? "inbound" : "outbound");
        const meta = msg.actorName ? '<div class="meta">' + msg.actorName + '</div>' : "";
        const body = (msg.body || "").trim() || (msg.type !== "TEXT" ? "[" + msg.type + "]" : "");
        bubble.innerHTML = meta + body + '<span class="time">' + formatTime(msg.sentAt) + '</span>';
        row.appendChild(bubble);
        messagesEl.appendChild(row);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function selectConversation(id) {
      activeId = id;
      const conv = conversationViews.find((c) => c.id === id);
      if (!conv) return;
      chatEmpty.style.display = "none";
      chatHeader.classList.add("visible");
      messagesEl.classList.add("visible");
      chatTitle.textContent = conv.contact.name;
      chatSubtitle.textContent = conv.contact.phone + (conv.inbox?.name ? " · " + conv.inbox.name : "");
      chatAvatar.textContent = initials(conv.contact.name);
      renderMessages(conv);
      renderList();
    }

    searchEl.addEventListener("input", () => {
      const q = searchEl.value.trim().toLowerCase();
      filtered = q
        ? conversationViews.filter((c) => c.searchText.includes(q))
        : conversationViews;
      renderList();
    });

    renderList();
  </script>
</body>
</html>`;

  return Buffer.from(html, "utf-8");
}
