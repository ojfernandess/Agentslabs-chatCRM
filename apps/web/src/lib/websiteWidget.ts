export type WebsiteWidgetForm = {
  websiteUrl: string;
  widgetColor: string;
  siteName: string;
  welcomeTitle: string;
  welcomeMessage: string;
  welcomeTagline: string;
  avatarUrl: string;
  widgetPosition: "left" | "right";
  bubbleType: "standard" | "expanded";
  bubbleLauncherTitle: string;
  greetingEnabled: boolean;
  responseTimeLabel: string;
};

export const emptyWebsiteWidgetForm = (inboxName = ""): WebsiteWidgetForm => ({
  websiteUrl: "",
  widgetColor: "#2563eb",
  siteName: inboxName,
  welcomeTitle: "Olá!",
  welcomeMessage:
    "Nós tornamos simples a conexão conosco. Pergunte qualquer assunto ou compartilhe seus comentários.",
  welcomeTagline: "Respondemos em alguns minutos",
  avatarUrl: "",
  widgetPosition: "right",
  bubbleType: "standard",
  bubbleLauncherTitle: "Fale conosco no chat",
  greetingEnabled: false,
  responseTimeLabel: "Respondemos em alguns minutos",
});

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function websiteWidgetFromChannelConfig(
  raw: unknown,
  inboxName = "",
): WebsiteWidgetForm {
  const base = emptyWebsiteWidgetForm(inboxName);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const pos = str(o.widgetPosition);
  const bubble = str(o.bubbleType);
  return {
    websiteUrl: str(o.websiteUrl) || base.websiteUrl,
    widgetColor: str(o.widgetColor) || base.widgetColor,
    siteName: str(o.siteName) || base.siteName,
    welcomeTitle: str(o.welcomeTitle) || base.welcomeTitle,
    welcomeMessage: str(o.welcomeMessage) || base.welcomeMessage,
    welcomeTagline: str(o.welcomeTagline) || base.welcomeTagline,
    avatarUrl: str(o.avatarUrl) || base.avatarUrl,
    widgetPosition: pos === "left" ? "left" : "right",
    bubbleType: bubble === "expanded" ? "expanded" : "standard",
    bubbleLauncherTitle: str(o.bubbleLauncherTitle) || base.bubbleLauncherTitle,
    greetingEnabled: o.greetingEnabled === true,
    responseTimeLabel: str(o.responseTimeLabel) || base.responseTimeLabel,
  };
}

export function websiteWidgetToChannelConfig(form: WebsiteWidgetForm): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const set = (k: string, v: string | boolean) => {
    if (typeof v === "boolean") {
      if (v) o[k] = v;
      return;
    }
    if (v.trim()) o[k] = v.trim();
  };
  set("websiteUrl", form.websiteUrl);
  set("widgetColor", form.widgetColor);
  set("siteName", form.siteName);
  set("welcomeTitle", form.welcomeTitle);
  set("welcomeMessage", form.welcomeMessage);
  set("welcomeTagline", form.welcomeTagline);
  set("avatarUrl", form.avatarUrl);
  o.widgetPosition = form.widgetPosition;
  o.bubbleType = form.bubbleType;
  set("bubbleLauncherTitle", form.bubbleLauncherTitle);
  set("responseTimeLabel", form.responseTimeLabel);
  if (form.greetingEnabled) o.greetingEnabled = true;
  return o;
}

export function buildWebsiteEmbedScript(baseUrl: string, websiteToken: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const token = websiteToken.replace(/'/g, "\\'");
  return `<script>
  (function(d,t) {
    var BASE_URL="${base}";
    var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
    g.src=BASE_URL+"/api/v1/public/widget/opennexo-widget.js";
    g.async=true;
    s.parentNode.insertBefore(g,s);
    g.onload=function(){
      window.opennexoSDK.run({
        websiteToken: '${token}',
        baseUrl: BASE_URL
      });
    };
  })(document,"script");
</script>`;
}
