export type PreChatFormFieldType = "text" | "email" | "tel";

export type PreChatFormField = {
  key: string;
  type: PreChatFormFieldType;
  label: string;
  placeholder: string;
  required: boolean;
  enabled: boolean;
};

export type WebsiteBusinessHoursDay = {
  day: number;
  enabled: boolean;
  allDay?: boolean;
  start?: string;
  end?: string;
};

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
  preChatFormEnabled: boolean;
  preChatFormMessage: string;
  preChatFormFields: PreChatFormField[];
  businessHoursEnabled: boolean;
  businessHoursTimezone: string;
  businessHoursUnavailableMessage: string;
  businessHoursDays: WebsiteBusinessHoursDay[];
};

export const DEFAULT_PRE_CHAT_FIELDS: PreChatFormField[] = [
  {
    key: "emailAddress",
    type: "email",
    label: "E-mail",
    placeholder: "Endereço de e-mail",
    required: true,
    enabled: true,
  },
  {
    key: "fullName",
    type: "text",
    label: "Nome",
    placeholder: "Seu nome",
    required: true,
    enabled: true,
  },
  {
    key: "phoneNumber",
    type: "tel",
    label: "Telefone",
    placeholder: "11 - 99999-9999",
    required: false,
    enabled: true,
  },
];

export const DEFAULT_BUSINESS_HOURS_DAYS: WebsiteBusinessHoursDay[] = [
  { day: 1, enabled: true, start: "09:00", end: "18:00" },
  { day: 2, enabled: true, start: "09:00", end: "18:00" },
  { day: 3, enabled: true, start: "09:00", end: "18:00" },
  { day: 4, enabled: true, start: "09:00", end: "17:00" },
  { day: 5, enabled: true, start: "09:00", end: "17:00" },
  { day: 6, enabled: false, start: "09:00", end: "17:00" },
  { day: 7, enabled: false, start: "09:00", end: "17:00" },
];

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
  preChatFormEnabled: false,
  preChatFormMessage: "Preencha as informações abaixo, para iniciar seu atendimento.",
  preChatFormFields: DEFAULT_PRE_CHAT_FIELDS.map((f) => ({ ...f })),
  businessHoursEnabled: false,
  businessHoursTimezone: "America/Sao_Paulo",
  businessHoursUnavailableMessage:
    "No momento estamos fora do horário de atendimento. Deixe sua mensagem que retornaremos em breve.",
  businessHoursDays: DEFAULT_BUSINESS_HOURS_DAYS.map((d) => ({ ...d })),
});

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parsePreChatFields(raw: unknown): PreChatFormField[] {
  if (!Array.isArray(raw)) return DEFAULT_PRE_CHAT_FIELDS.map((f) => ({ ...f }));
  const fields: PreChatFormField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const key = str(o.key);
    if (!key) continue;
    const typeRaw = str(o.type);
    const type = typeRaw === "email" || typeRaw === "tel" ? typeRaw : "text";
    fields.push({
      key,
      type,
      label: str(o.label) || key,
      placeholder: str(o.placeholder),
      required: o.required === true,
      enabled: o.enabled !== false,
    });
  }
  return fields.length ? fields : DEFAULT_PRE_CHAT_FIELDS.map((f) => ({ ...f }));
}

function parseBusinessHoursDays(raw: unknown): WebsiteBusinessHoursDay[] {
  if (!Array.isArray(raw)) return DEFAULT_BUSINESS_HOURS_DAYS.map((d) => ({ ...d }));
  const days: WebsiteBusinessHoursDay[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const day = typeof o.day === "number" ? o.day : null;
    if (day == null || day < 1 || day > 7) continue;
    days.push({
      day,
      enabled: o.enabled === true,
      allDay: o.allDay === true,
      start: typeof o.start === "string" ? o.start : "09:00",
      end: typeof o.end === "string" ? o.end : "18:00",
    });
  }
  if (!days.length) return DEFAULT_BUSINESS_HOURS_DAYS.map((d) => ({ ...d }));
  const byDay = new Map(DEFAULT_BUSINESS_HOURS_DAYS.map((d) => [d.day, { ...d }]));
  for (const d of days) {
    byDay.set(d.day, { ...byDay.get(d.day)!, ...d });
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
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
    preChatFormEnabled: o.preChatFormEnabled === true,
    preChatFormMessage: str(o.preChatFormMessage) || base.preChatFormMessage,
    preChatFormFields: parsePreChatFields(o.preChatFormFields),
    businessHoursEnabled: o.businessHoursEnabled === true,
    businessHoursTimezone: str(o.businessHoursTimezone) || base.businessHoursTimezone,
    businessHoursUnavailableMessage:
      str(o.businessHoursUnavailableMessage) || base.businessHoursUnavailableMessage,
    businessHoursDays: parseBusinessHoursDays(o.businessHoursDays),
  };
}

export function websiteWidgetToChannelConfig(form: WebsiteWidgetForm): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const set = (k: string, v: string | boolean) => {
    if (typeof v === "boolean") {
      o[k] = v;
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
  o.greetingEnabled = form.greetingEnabled;
  o.preChatFormEnabled = form.preChatFormEnabled;
  set("preChatFormMessage", form.preChatFormMessage);
  o.preChatFormFields = form.preChatFormFields.map((f) => ({ ...f }));
  o.businessHoursEnabled = form.businessHoursEnabled;
  set("businessHoursTimezone", form.businessHoursTimezone);
  set("businessHoursUnavailableMessage", form.businessHoursUnavailableMessage);
  o.businessHoursDays = form.businessHoursDays.map((d) => ({ ...d }));
  return o;
}

export function buildWebsiteEmbedScript(baseUrl: string, websiteToken: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const token = websiteToken.replace(/'/g, "\\'");
  return `<script>
  (function(d,t) {
    var BASE_URL="${base}";
    var TOKEN='${token}';
    fetch(BASE_URL+"/api/v1/public/widget/"+encodeURIComponent(TOKEN)+"/settings")
      .then(function(r){ if(!r.ok) throw new Error("settings"); return r.json(); })
      .then(function(settings){
        var rev=(settings.revision||"1")+"."+(settings.sdkVersion||"1");
        var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
        g.src=BASE_URL+"/api/v1/public/widget/opennexo-widget.js?v="+encodeURIComponent(rev);
        g.async=true;
        s.parentNode.insertBefore(g,s);
        g.onload=function(){
          window.opennexoSDK.run({
            websiteToken: TOKEN,
            baseUrl: BASE_URL,
            settings: settings
          });
        };
        g.onerror=function(){
          console.error("[OpenConduit] Falha ao carregar widget.js");
        };
      })
      .catch(function(){
        var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
        g.src=BASE_URL+"/api/v1/public/widget/opennexo-widget.js?v=1";
        g.async=true;
        s.parentNode.insertBefore(g,s);
        g.onload=function(){
          window.opennexoSDK.run({ websiteToken: TOKEN, baseUrl: BASE_URL });
        };
      });
  })(document,"script");
</script>`;
}
