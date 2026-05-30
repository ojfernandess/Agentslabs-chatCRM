(function (global) {
  "use strict";

  var VISITOR_KEY = "opennexo_visitor_id";
  var STYLE_ID = "opennexo-widget-styles";

  var ICON_CHAT =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 2H4a2 2 0 0 0-2 2v14l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  var ICON_SEND =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  var ICON_CLOSE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

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

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) {
      if (typeof html === "string" && html.indexOf("<") >= 0) n.innerHTML = html;
      else n.textContent = html;
    }
    return n;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "#opennexo-widget-root,#opennexo-widget-root *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}" +
      "@keyframes onx-slide-up{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}" +
      "@keyframes onx-pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}" +
      "@keyframes onx-msg-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}" +
      ".onx-panel{animation:onx-slide-up .32s cubic-bezier(.22,1,.36,1)}" +
      ".onx-launcher{animation:onx-pop .24s ease-out}" +
      ".onx-msg{animation:onx-msg-in .2s ease-out}";
    document.head.appendChild(s);
  }

  function profileKey(token) {
    return "opennexo_profile_" + token;
  }

  function loadProfile(token) {
    try {
      var raw = localStorage.getItem(profileKey(token));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveProfile(token, data) {
    try {
      localStorage.setItem(profileKey(token), JSON.stringify(data));
    } catch (e) {}
  }

  function profilePayload(profile) {
    return {
      name: profile.fullName || profile.name || undefined,
      email: profile.emailAddress || profile.email || undefined,
      phone: profile.phoneNumber || profile.phone || undefined,
    };
  }

  function mountWidget(opts, settings) {
    injectStyles();

    var base = (opts.baseUrl || "").replace(/\/+$/, "");
    var token = opts.websiteToken;
    var color = settings.widgetColor || "#2563eb";
    var position = settings.widgetPosition === "left" ? "left" : "right";
    var siteName = settings.siteName || settings.inboxName || "Chat";
    var welcomeTitle = settings.welcomeTitle || "Olá!";
    var tagline = settings.welcomeTagline || settings.responseTimeLabel || "Respondemos em alguns minutos";
    var welcomeMsg =
      settings.welcomeMessage ||
      "Nós tornamos simples a conexão conosco. Pergunte qualquer assunto ou compartilhe seus comentários.";
    var launcherText = settings.bubbleLauncherTitle || "Fale conosco";
    var isExpanded = settings.bubbleType === "expanded";
    var avatarUrl = settings.avatarUrl || "";
    var preChatEnabled = settings.preChatFormEnabled === true;
    var preChatMessage =
      settings.preChatFormMessage || "Preencha as informações abaixo, para iniciar seu atendimento.";
    var preChatFields = Array.isArray(settings.preChatFormFields)
      ? settings.preChatFormFields.filter(function (f) {
          return f && f.enabled !== false;
        })
      : [];
    var storedProfile = loadProfile(token);

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    var root = el("div");
    root.id = "opennexo-widget-root";
    root.setAttribute(
      "style",
      "position:fixed;z-index:2147483000;" + position + ":24px;bottom:24px;display:flex;flex-direction:column;align-items:" +
        (position === "left" ? "flex-start" : "flex-end") +
        ";gap:12px;",
    );

    var panel = el("div", "onx-panel");
    panel.setAttribute(
      "style",
      "display:none;width:min(392px,calc(100vw - 32px));height:min(560px,calc(100vh - 96px));background:#fff;border-radius:20px;box-shadow:0 24px 64px rgba(15,23,42,.18),0 0 0 1px rgba(15,23,42,.06);overflow:hidden;flex-direction:column;",
    );

    var header = el("div");
    header.setAttribute(
      "style",
      "position:relative;background:linear-gradient(145deg," +
        color +
        " 0%," +
        color +
        "dd 100%);color:#fff;padding:20px 20px 18px;flex-shrink:0;",
    );

    var headerTop = el("div");
    headerTop.setAttribute("style", "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;");

    var headerBrand = el("div");
    headerBrand.setAttribute("style", "display:flex;align-items:center;gap:12px;min-width:0;flex:1;");

    if (avatarUrl) {
      var avatar = el("img");
      avatar.src = avatarUrl;
      avatar.alt = "";
      avatar.setAttribute(
        "style",
        "width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.35);flex-shrink:0;",
      );
      headerBrand.appendChild(avatar);
    } else {
      var avatarFallback = el("div", null, siteName.charAt(0).toUpperCase());
      avatarFallback.setAttribute(
        "style",
        "width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0;",
      );
      headerBrand.appendChild(avatarFallback);
    }

    var headerText = el("div");
    headerText.setAttribute("style", "min-width:0;");
    var titleEl = el("div", null, siteName);
    titleEl.setAttribute("style", "font-size:17px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
    var sub = el("div", null, tagline);
    sub.setAttribute("style", "font-size:12px;opacity:.92;margin-top:4px;line-height:1.35;");
    headerText.appendChild(titleEl);
    headerText.appendChild(sub);
    headerBrand.appendChild(headerText);

    var closeBtn = el("button", null, ICON_CLOSE);
    closeBtn.type = "button";
    closeBtn.setAttribute(
      "aria-label",
      "Fechar chat",
    );
    closeBtn.setAttribute(
      "style",
      "width:36px;height:36px;border-radius:10px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s;",
    );
    closeBtn.onmouseenter = function () {
      closeBtn.style.background = "rgba(255,255,255,.28)";
    };
    closeBtn.onmouseleave = function () {
      closeBtn.style.background = "rgba(255,255,255,.16)";
    };

    headerTop.appendChild(headerBrand);
    headerTop.appendChild(closeBtn);
    header.appendChild(headerTop);

    var body = el("div");
    body.setAttribute(
      "style",
      "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px 24px;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);text-align:center;",
    );

    var wave = el("div", null, "👋");
    wave.setAttribute(
      "style",
      "width:56px;height:56px;border-radius:50%;background:#fff;box-shadow:0 4px 16px rgba(15,23,42,.08);display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:16px;",
    );
    var h3 = el("h3", null, welcomeTitle);
    h3.setAttribute("style", "margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;");
    var p = el("p", null, welcomeMsg);
    p.setAttribute("style", "margin:0;font-size:14px;line-height:1.6;color:#64748b;max-width:280px;");

    body.appendChild(wave);
    body.appendChild(h3);
    body.appendChild(p);

    var preChat = el("div");
    preChat.setAttribute(
      "style",
      "display:none;flex:1;flex-direction:column;min-height:0;background:linear-gradient(180deg,#f8fafc 0%,#fff 100%);",
    );
    var preChatScroll = el("div");
    preChatScroll.setAttribute("style", "flex:1;overflow:auto;padding:20px 20px 12px;");
    var preChatIntro = el("p", null, preChatMessage);
    preChatIntro.setAttribute("style", "margin:0 0 16px;font-size:14px;line-height:1.55;color:#64748b;");
    preChatScroll.appendChild(preChatIntro);
    var preChatInputs = {};
    preChatFields.forEach(function (field) {
      var wrap = el("label");
      wrap.setAttribute("style", "display:block;margin-bottom:12px;");
      var label = el("span", null, field.label + (field.required ? " *" : ""));
      label.setAttribute("style", "display:block;margin-bottom:6px;font-size:12px;font-weight:600;color:#334155;");
      var inputField = el("input");
      inputField.type = field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text";
      inputField.placeholder = field.placeholder || "";
      inputField.setAttribute(
        "style",
        "width:100%;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;font-size:14px;outline:none;font-family:inherit;",
      );
      if (storedProfile && storedProfile[field.key]) inputField.value = storedProfile[field.key];
      preChatInputs[field.key] = inputField;
      wrap.appendChild(label);
      wrap.appendChild(inputField);
      preChatScroll.appendChild(wrap);
    });
    var preChatError = el("div");
    preChatError.setAttribute("style", "display:none;margin-top:4px;font-size:12px;color:#b91c1c;");
    preChatScroll.appendChild(preChatError);
    var preChatFooter = el("div");
    preChatFooter.setAttribute("style", "padding:0 20px 16px;flex-shrink:0;");
    var preChatSubmit = el("button", null, "Iniciar atendimento");
    preChatSubmit.type = "button";
    preChatSubmit.setAttribute(
      "style",
      "width:100%;background:" +
        color +
        ";color:#fff;border:none;border-radius:14px;padding:14px 18px;font-weight:600;font-size:15px;cursor:pointer;",
    );
    preChatFooter.appendChild(preChatSubmit);
    preChat.appendChild(preChatScroll);
    preChat.appendChild(preChatFooter);

    var chat = el("div");
    chat.setAttribute("style", "display:none;flex:1;flex-direction:column;min-height:0;background:#f1f5f9;");
    var messages = el("div");
    messages.setAttribute("style", "flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:8px;");

    var form = el("form");
    form.setAttribute(
      "style",
      "display:flex;gap:8px;padding:12px 14px;border-top:1px solid #e2e8f0;background:#fff;align-items:flex-end;",
    );
    var input = el("textarea");
    input.rows = 1;
    input.placeholder = "Escreva a sua mensagem…";
    input.setAttribute(
      "style",
      "flex:1;resize:none;border:1px solid #e2e8f0;border-radius:14px;padding:10px 14px;font-size:14px;line-height:1.4;max-height:96px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s;",
    );
    input.onfocus = function () {
      input.style.borderColor = color;
      input.style.boxShadow = "0 0 0 3px " + color + "22";
    };
    input.onblur = function () {
      input.style.borderColor = "#e2e8f0";
      input.style.boxShadow = "none";
    };

    var send = el("button", null, ICON_SEND);
    send.type = "submit";
    send.setAttribute("aria-label", "Enviar");
    send.setAttribute(
      "style",
      "width:42px;height:42px;border-radius:50%;background:" +
        color +
        ";color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:transform .12s,opacity .12s;",
    );

    form.appendChild(input);
    form.appendChild(send);
    chat.appendChild(messages);
    chat.appendChild(form);

    var footer = el("div");
    footer.setAttribute("style", "padding:0 20px 20px;background:linear-gradient(180deg,#fff 0%,#f8fafc 100%);flex-shrink:0;");
    var startBtn = el("button", null, "Iniciar conversa");
    startBtn.type = "button";
    startBtn.setAttribute(
      "style",
      "width:100%;background:" +
        color +
        ";color:#fff;border:none;border-radius:14px;padding:14px 18px;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 8px 24px " +
        color +
        "44;transition:transform .12s,box-shadow .12s;",
    );
    startBtn.onmouseenter = function () {
      startBtn.style.transform = "translateY(-1px)";
    };
    startBtn.onmouseleave = function () {
      startBtn.style.transform = "none";
    };
    footer.appendChild(startBtn);

    var powered = el("div", null, "Powered by OpenConduit");
    powered.setAttribute(
      "style",
      "padding:8px;text-align:center;font-size:10px;color:#94a3b8;background:#fff;border-top:1px solid #f1f5f9;flex-shrink:0;",
    );

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(preChat);
    panel.appendChild(chat);
    panel.appendChild(footer);
    panel.appendChild(powered);

    var visitorProfile = storedProfile;

    function showChatView() {
      body.style.display = "none";
      footer.style.display = "none";
      preChat.style.display = "none";
      chat.style.display = "flex";
      input.focus();
    }

    function showInitialView() {
      chat.style.display = "none";
      if (preChatEnabled && !visitorProfile && preChatFields.length > 0) {
        body.style.display = "none";
        footer.style.display = "none";
        preChat.style.display = "flex";
      } else {
        preChat.style.display = "none";
        body.style.display = "flex";
        footer.style.display = "block";
      }
    }

    var bubble = el("button", "onx-launcher");
    bubble.type = "button";
    bubble.setAttribute("aria-label", "Abrir chat");

    if (isExpanded) {
      bubble.innerHTML =
        '<span style="display:inline-flex;align-items:center;gap:8px;max-width:220px;">' +
        ICON_CHAT +
        '<span style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        escapeHtml(launcherText) +
        "</span></span>";
      bubble.setAttribute(
        "style",
        "height:52px;padding:0 18px;border-radius:999px;background:" +
          color +
          ";color:#fff;border:none;box-shadow:0 8px 28px " +
          color +
          "55;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;",
      );
    } else {
      bubble.innerHTML = ICON_CHAT;
      bubble.setAttribute(
        "style",
        "width:56px;height:56px;border-radius:50%;background:" +
          color +
          ";color:#fff;border:none;box-shadow:0 8px 28px " +
          color +
          "55;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;",
      );
    }

    bubble.onmouseenter = function () {
      bubble.style.transform = "scale(1.04)";
    };
    bubble.onmouseleave = function () {
      bubble.style.transform = "scale(1)";
    };

    root.appendChild(panel);
    root.appendChild(bubble);
    document.body.appendChild(root);

    var open = false;

    function setOpen(next) {
      open = next;
      panel.style.display = open ? "flex" : "none";
      if (open) showInitialView();
      if (isExpanded) {
        bubble.style.display = open ? "none" : "inline-flex";
      } else {
        bubble.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
      }
    }

    function toggle() {
      setOpen(!open);
    }

    bubble.addEventListener("click", toggle);
    closeBtn.addEventListener("click", toggle);

    startBtn.addEventListener("click", showChatView);

    preChatSubmit.addEventListener("click", function () {
      preChatError.style.display = "none";
      var values = {};
      for (var i = 0; i < preChatFields.length; i++) {
        var field = preChatFields[i];
        var node = preChatInputs[field.key];
        var val = node ? String(node.value || "").trim() : "";
        if (field.required && !val) {
          preChatError.textContent = "Preencha o campo: " + field.label;
          preChatError.style.display = "block";
          if (node) node.focus();
          return;
        }
        if (val) values[field.key] = val;
      }
      visitorProfile = values;
      saveProfile(token, values);
      var payload = profilePayload(values);
      var registerText = "Início do atendimento via formulário pré-chat.";
      preChatSubmit.disabled = true;
      sendMessage(registerText, payload)
        .then(function () {
          showChatView();
        })
        .catch(function () {
          preChatError.textContent = "Não foi possível iniciar o atendimento. Tente novamente.";
          preChatError.style.display = "block";
        })
        .finally(function () {
          preChatSubmit.disabled = false;
        });
    });

    function appendMsg(text, outbound, isError) {
      var wrap = el("div", "onx-msg");
      wrap.setAttribute("style", "display:flex;" + (outbound ? "justify-content:flex-end;" : "justify-content:flex-start;"));
      var m = el("div", null, text);
      var bg = isError ? "#fef2f2" : outbound ? color : "#fff";
      var fg = isError ? "#b91c1c" : outbound ? "#fff" : "#0f172a";
      var border = isError ? "1px solid #fecaca" : outbound ? "none" : "1px solid #e2e8f0";
      m.setAttribute(
        "style",
        "padding:10px 14px;border-radius:16px;max-width:82%;font-size:14px;line-height:1.45;word-break:break-word;" +
          "background:" +
          bg +
          ";color:" +
          fg +
          ";border:" +
          border +
          ";" +
          (outbound ? "border-bottom-right-radius:4px;" : "border-bottom-left-radius:4px;") +
          "box-shadow:" +
          (outbound || isError ? "none" : "0 1px 2px rgba(15,23,42,.06)") +
          ";",
      );
      wrap.appendChild(m);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
    }

    function sendMessage(text, extra) {
      var url =
        base +
        "/api/v1/public/channels/inboxes/" +
        encodeURIComponent(token) +
        "/contacts/" +
        encodeURIComponent(visitorId()) +
        "/messages";

      var bodyPayload = { content: text };
      var profile = extra || (visitorProfile ? profilePayload(visitorProfile) : null);
      if (profile) {
        if (profile.name) bodyPayload.name = profile.name;
        if (profile.email) bodyPayload.email = profile.email;
        if (profile.phone) bodyPayload.phone = profile.phone;
      }

      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = (input.value || "").trim();
      if (!text) return;
      input.value = "";
      appendMsg(text, true, false);
      sendMessage(text).catch(function () {
        appendMsg("Não foi possível enviar. Tente novamente.", false, true);
      });
    });

    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        form.requestSubmit();
      }
    });

    if (settings.greetingEnabled) {
      setTimeout(function () {
        if (!open) setOpen(true);
      }, 1200);
    }
  }

  function run(opts) {
    if (!opts || !opts.websiteToken) {
      console.error("[OpenNexo] websiteToken is required");
      return;
    }
    if (opts.settings) {
      mountWidget(opts, opts.settings);
      return;
    }
    var base = (opts.baseUrl || "").replace(/\/+$/, "");
    var settingsUrl =
      base + "/api/v1/public/widget/" + encodeURIComponent(opts.websiteToken) + "/settings";
    fetch(settingsUrl)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
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
          responseTimeLabel: "Respondemos em alguns minutos",
        });
      });
  }

  global.opennexoSDK = { run: run };
})(typeof window !== "undefined" ? window : globalThis);
