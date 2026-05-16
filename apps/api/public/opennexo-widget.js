(function (global) {
  "use strict";

  var VISITOR_KEY = "opennexo_visitor_id";

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function visitorId() {
    try {
      var id = localStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mountWidget(opts, settings) {
    var base = (opts.baseUrl || "").replace(/\/+$/, "");
    var token = opts.websiteToken;
    var color = settings.widgetColor || "#2563eb";
    var position = settings.widgetPosition === "left" ? "left" : "right";
    var siteName = settings.siteName || settings.inboxName || "Chat";
    var welcomeTitle = settings.welcomeTitle || "Olá!";
    var tagline = settings.welcomeTagline || settings.responseTimeLabel || "";
    var welcomeMsg =
      settings.welcomeMessage ||
      "Nós tornamos simples a conexão conosco. Pergunte qualquer assunto ou compartilhe seus comentários.";
    var launcher =
      settings.bubbleLauncherTitle || (settings.bubbleType === "expanded" ? siteName : "💬");

    var root = el("div");
    root.id = "opennexo-widget-root";
    root.setAttribute(
      "style",
      "position:fixed;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
        position +
        ":20px;bottom:20px;",
    );

    var panel = el("div");
    panel.setAttribute(
      "style",
      "display:none;width:min(400px,calc(100vw - 40px));height:min(520px,calc(100vh - 100px));background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.18);overflow:hidden;flex-direction:column;margin-bottom:12px;",
    );

    var header = el("div");
    header.setAttribute("style", "background:" + color + ";color:#fff;padding:16px 18px;");
    header.appendChild(el("div", null, siteName));
    var sub = el("div", null, tagline);
    sub.setAttribute("style", "font-size:12px;opacity:.9;margin-top:4px;");
    header.appendChild(sub);

    var body = el("div");
    body.setAttribute("style", "flex:1;padding:20px;overflow:auto;background:#f8fafc;");
    body.appendChild(el("h3", null, welcomeTitle));
    var p = el("p", null, welcomeMsg);
    p.setAttribute("style", "margin-top:8px;font-size:14px;line-height:1.5;color:#475569;");
    body.appendChild(p);

    var chat = el("div");
    chat.setAttribute("style", "display:none;flex:1;flex-direction:column;min-height:0;");
    var messages = el("div");
    messages.setAttribute("style", "flex:1;overflow:auto;padding:12px;font-size:14px;");
    var form = el("form");
    form.setAttribute("style", "display:flex;gap:8px;padding:12px;border-top:1px solid #e2e8f0;background:#fff;");
    var input = el("input");
    input.type = "text";
    input.placeholder = "Escreva a sua mensagem…";
    input.setAttribute("style", "flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px;");
    var send = el("button", null, "Enviar");
    send.type = "submit";
    send.setAttribute(
      "style",
      "background:" + color + ";color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer;",
    );
    form.appendChild(input);
    form.appendChild(send);
    chat.appendChild(messages);
    chat.appendChild(form);

    var footer = el("div");
    footer.setAttribute("style", "padding:14px 16px;border-top:1px solid #e2e8f0;background:#fff;");
    var startBtn = el("button", null, "Iniciar conversa →");
    startBtn.type = "button";
    startBtn.setAttribute(
      "style",
      "width:100%;background:" + color + ";color:#fff;border:none;border-radius:10px;padding:12px;font-weight:600;cursor:pointer;",
    );
    footer.appendChild(startBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(chat);
    panel.appendChild(footer);

    var bubble = el("button", null, launcher);
    bubble.type = "button";
    bubble.setAttribute(
      "style",
      "width:" +
        (settings.bubbleType === "expanded" ? "auto" : "56px") +
        ";height:56px;min-width:56px;border-radius:999px;background:" +
        color +
        ";color:#fff;border:none;box-shadow:0 4px 20px rgba(0,0,0,.2);cursor:pointer;font-size:" +
        (settings.bubbleType === "expanded" ? "14px" : "22px") +
        ";padding:0 16px;font-weight:600;",
    );

    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.alignItems = position === "left" ? "flex-start" : "flex-end";
    root.appendChild(panel);
    root.appendChild(bubble);
    document.body.appendChild(root);

    var open = false;
    var inChat = false;

    function toggle() {
      open = !open;
      panel.style.display = open ? "flex" : "none";
      bubble.textContent = open ? "✕" : launcher;
    }

    bubble.addEventListener("click", toggle);

    startBtn.addEventListener("click", function () {
      inChat = true;
      body.style.display = "none";
      footer.style.display = "none";
      chat.style.display = "flex";
    });

    function appendMsg(text, outbound) {
      var m = el("div", null, text);
      m.setAttribute(
        "style",
        "margin:6px 0;padding:8px 12px;border-radius:12px;max-width:85%;" +
          (outbound ? "background:" + color + ";color:#fff;margin-left:auto;" : "background:#e2e8f0;color:#0f172a;"),
      );
      messages.appendChild(m);
      messages.scrollTop = messages.scrollHeight;
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = (input.value || "").trim();
      if (!text) return;
      input.value = "";
      appendMsg(text, true);
      var url =
        base +
        "/api/v1/public/channels/inboxes/" +
        encodeURIComponent(token) +
        "/contacts/" +
        encodeURIComponent(visitorId()) +
        "/messages";
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      }).catch(function () {
        appendMsg("Não foi possível enviar. Tente novamente.", false);
      });
    });

    if (settings.greetingEnabled) {
      setTimeout(function () {
        if (!open) toggle();
      }, 800);
    }
  }

  function run(opts) {
    if (!opts || !opts.websiteToken) {
      console.error("[OpenNexo] websiteToken is required");
      return;
    }
    var base = (opts.baseUrl || "").replace(/\/+$/, "");
    var settingsUrl =
      base + "/api/v1/public/widget/" + encodeURIComponent(opts.websiteToken) + "/settings";
    fetch(settingsUrl)
      .then(function (r) {
        return r.json();
      })
      .then(function (settings) {
        mountWidget(opts, settings);
      })
      .catch(function () {
        mountWidget(opts, {
          siteName: "Chat",
          widgetColor: "#2563eb",
          welcomeTitle: "Olá!",
          welcomeMessage: "Como podemos ajudar?",
        });
      });
  }

  global.opennexoSDK = { run: run };
})(typeof window !== "undefined" ? window : globalThis);
