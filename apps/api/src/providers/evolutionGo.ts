import crypto from "node:crypto";
import {
  WhatsAppProviderInterface,
  SendMessageParams,
  IncomingMessage,
  StatusUpdate,
} from "./types.js";
import { evolutionGoGetStatus } from "../lib/evolutionGoApi.js";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function jidToE164(remoteJid: string): string | null {
  if (!remoteJid || remoteJid.includes("@g.us")) return null;
  let localPart = remoteJid.split("@")[0];
  if (localPart.includes(":")) {
    localPart = localPart.split(":")[0] ?? localPart;
  }
  if (!localPart || !/^\d+$/.test(localPart)) return null;
  return `+${localPart}`;
}

function jidOrAltToE164(remoteJid: string, remoteJidAlt: string): string | null {
  return jidToE164(remoteJid) ?? (remoteJidAlt ? jidToE164(remoteJidAlt) : null);
}

function groupJidToSyntheticE164(remoteJid: string): string | null {
  const local = remoteJid.split("@")[0]?.trim() ?? "";
  const d = local.replace(/\D/g, "");
  if (!d) return null;
  const twelve = (d + "000000000000").slice(0, 12);
  return `+888${twelve}`;
}

function destinationForSend(to: string): string {
  const t = to.trim();
  if (t.includes("@g.us")) return t;
  const d = digitsOnly(t);
  if (!d) throw new Error("Evolution Go: invalid destination number");
  return d;
}

function parseIsoOrNow(s: unknown): Date {
  if (typeof s === "string" && s.trim()) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function mapReceiptState(state: string): StatusUpdate["status"] | null {
  const v = state.trim().toLowerCase();
  if (v === "delivered") return "DELIVERED";
  if (v === "read" || v === "readself") return "READ";
  return null;
}

function extractSendMessageId(payload: unknown): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const direct = typeof root.messageId === "string" ? root.messageId.trim() : "";
  if (direct) return direct;
  const data = asRecord(root.data);
  const info = asRecord(data?.Info ?? data?.info);
  const id = typeof info?.ID === "string" ? info.ID.trim() : typeof info?.id === "string" ? info.id.trim() : "";
  return id || null;
}

export class EvolutionGoProvider implements WhatsAppProviderInterface {
  private baseUrl: string;
  private apiKey: string;
  private instanceId?: string;

  constructor(baseUrl: string, apiKey: string, instanceId?: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.instanceId = instanceId;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.apiKey,
      "Content-Type": "application/json",
      ...(this.instanceId ? { instanceId: this.instanceId } : {}),
      ...(extra ?? {}),
    };
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    /** Modelos locais (sem Meta WABA): enviam o texto já substituído como mensagem normal. */
    if (params.type === "TEXT" || params.type === "TEMPLATE") {
      const text = params.body?.trim() ?? "";
      if (!text) {
        throw new Error("Evolution Go: text body required");
      }
      const url = `${this.baseUrl}/send/text`;
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          number: destinationForSend(params.to),
          text,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Evolution Go error: ${response.status} ${err}`);
      }
      const data = (await response.json()) as unknown;
      const id = extractSendMessageId(data);
      if (!id) throw new Error("Evolution Go: missing message id in response");
      return id;
    }

    if (!params.mediaUrl) {
      throw new Error("Evolution Go: mediaUrl is required for non-text messages");
    }

    const typeMap: Record<string, string> = {
      IMAGE: "image",
      VIDEO: "video",
      AUDIO: "audio",
      DOCUMENT: "document",
    };
    const mappedType = typeMap[params.type] ?? "document";
    const url = `${this.baseUrl}/send/media`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        number: destinationForSend(params.to),
        type: mappedType,
        url: params.mediaUrl,
        caption: params.type === "AUDIO" ? undefined : params.body?.trim() || undefined,
        filename: params.type === "DOCUMENT" ? params.body?.trim() || undefined : undefined,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Evolution Go error: ${response.status} ${err}`);
    }
    const data = (await response.json()) as unknown;
    const id = extractSendMessageId(data);
    if (!id) throw new Error("Evolution Go: missing message id in response");
    return id;
  }

  parseWebhook(_headers: Record<string, string | undefined>, body: unknown) {
    const env = asRecord(body);
    if (!env) return { messages: [], statusUpdates: [] };

    const event = typeof env.event === "string" ? env.event.trim() : "";
    const eventUpper = event.toUpperCase();

    if (event === "Receipt" || eventUpper === "READ_RECEIPT") {
      const state = typeof env?.state === "string" ? env.state : "";
      const mapped = state ? mapReceiptState(state) : null;
      if (!mapped) return { messages: [], statusUpdates: [] };
      const data = asRecord(env?.data);
      const ts = parseIsoOrNow(data?.Timestamp ?? data?.timestamp);
      const ids = Array.isArray(data?.MessageIDs)
        ? (data?.MessageIDs as unknown[]).map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
        : [];
      const statusUpdates: StatusUpdate[] = ids.map((waMessageId) => ({
        waMessageId,
        status: mapped,
        timestamp: ts,
      }));
      return { messages: [], statusUpdates };
    }

    const isMessageEvent = eventUpper === "MESSAGE" || event === "Message" || event === "messages.upsert";

    if (!isMessageEvent) {
      const dataProbe = asRecord(env.data);
      const hasMessageShape =
        dataProbe?.Info ||
        dataProbe?.info ||
        dataProbe?.key ||
        dataProbe?.Message ||
        dataProbe?.message;
      if (!hasMessageShape) return { messages: [], statusUpdates: [] };
    }

    const data = asRecord(env.data) ?? env;
    if (!data) return { messages: [], statusUpdates: [] };

    const key = asRecord(data.key);
    const info = asRecord(data?.Info ?? data?.info);

    const keyFromMe = key?.fromMe === true || key?.FromMe === true;

    let waMessageId = "";
    let remoteJid = "";
    let senderJid = "";
    let senderAlt = "";
    let isGroup = false;
    let pushName: string | undefined;
    let timestamp = new Date();
    if (key) {
      if (keyFromMe) return { messages: [], statusUpdates: [] };
      waMessageId = typeof key.id === "string" ? key.id.trim() : "";
      remoteJid = typeof key.remoteJid === "string" ? key.remoteJid.trim() : "";
      senderAlt =
        typeof key.remoteJidAlt === "string" && key.remoteJidAlt.trim()
          ? key.remoteJidAlt.trim()
          : typeof data.remoteJidAlt === "string" && data.remoteJidAlt.trim()
            ? data.remoteJidAlt.trim()
            : "";
      isGroup = remoteJid.includes("@g.us");
      pushName =
        typeof data.pushName === "string" && data.pushName.trim()
          ? data.pushName.trim()
          : typeof key.pushName === "string" && key.pushName.trim()
            ? key.pushName.trim()
            : undefined;
      timestamp = parseIsoOrNow(data.messageTimestamp ?? data.timestamp);
    } else if (info) {
      if (info.IsFromMe === true || info.isFromMe === true) return { messages: [], statusUpdates: [] };
      waMessageId = typeof info.ID === "string" && info.ID.trim() ? info.ID.trim() : "";
      remoteJid = typeof info.Chat === "string" ? info.Chat.trim() : "";
      senderJid = typeof info.Sender === "string" ? info.Sender.trim() : "";
      senderAlt = typeof info.SenderAlt === "string" ? info.SenderAlt.trim() : "";
      isGroup = info.IsGroup === true || remoteJid.includes("@g.us");
      pushName = typeof info.PushName === "string" && info.PushName.trim() ? info.PushName.trim() : undefined;
      timestamp = parseIsoOrNow(info.Timestamp);
    } else {
      return { messages: [], statusUpdates: [] };
    }

    if (!waMessageId) return { messages: [], statusUpdates: [] };

    let from: string | null = null;
    let groupJid: string | undefined;
    let participantE164: string | null | undefined;

    if (isGroup) {
      const jid = remoteJid;
      if (!jid) return { messages: [], statusUpdates: [] };
      from = groupJidToSyntheticE164(jid);
      if (!from) return { messages: [], statusUpdates: [] };
      groupJid = jid;
      participantE164 = senderJid ? jidOrAltToE164(senderJid, senderAlt) : null;
    } else {
      from =
        jidOrAltToE164(remoteJid, senderAlt) ??
        jidOrAltToE164(senderJid, senderAlt) ??
        (remoteJid.includes("@lid") && senderJid ? jidToE164(senderJid) : null);
      if (!from) {
        const participant = typeof data.participant === "string" ? data.participant.trim() : "";
        from = participant ? jidToE164(participant) : null;
      }
      if (!from) return { messages: [], statusUpdates: [] };
    }

    const msg = asRecord(data?.Message ?? data?.message) ?? {};
    let type = "TEXT";
    let bodyText: string | undefined;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;

    const conv = typeof msg.conversation === "string" ? msg.conversation : undefined;
    const ext = asRecord(msg.extendedTextMessage);
    const extText = ext && typeof ext.text === "string" ? ext.text : undefined;
    bodyText = extText ?? conv;

    const mediaTypeHint =
      typeof info?.MediaType === "string"
        ? info.MediaType.trim().toLowerCase()
        : typeof data.mediaType === "string"
          ? data.mediaType.trim().toLowerCase()
          : "";
    const base64 = typeof msg.base64 === "string" && msg.base64.trim() ? msg.base64.trim() : "";

    const img = asRecord(msg.imageMessage);
    const video = asRecord(msg.videoMessage);
    const audio = asRecord(msg.audioMessage);
    const doc = asRecord(msg.documentMessage);
    const docCap = asRecord(msg.documentWithCaptionMessage);
    const docInner = asRecord(asRecord(docCap?.message)?.documentMessage);

    if (mediaTypeHint === "image" || img) {
      type = "IMAGE";
      mediaUrl = typeof img?.url === "string" ? img.url : undefined;
      mediaType = typeof img?.mimetype === "string" ? img.mimetype : "image/jpeg";
      const cap = typeof img?.caption === "string" ? img.caption : undefined;
      if (cap) bodyText = cap;
    } else if (mediaTypeHint === "video" || video) {
      type = "VIDEO";
      mediaUrl = typeof video?.url === "string" ? video.url : undefined;
      mediaType = typeof video?.mimetype === "string" ? video.mimetype : "video/mp4";
      const cap = typeof video?.caption === "string" ? video.caption : undefined;
      if (cap) bodyText = cap;
    } else if (mediaTypeHint === "audio" || audio) {
      type = "AUDIO";
      mediaUrl = typeof audio?.url === "string" ? audio.url : undefined;
      mediaType = typeof audio?.mimetype === "string" ? audio.mimetype : "audio/ogg";
    } else if (mediaTypeHint === "document" || doc || docInner) {
      type = "DOCUMENT";
      const d = docInner ?? doc;
      mediaUrl = typeof d?.url === "string" ? d.url : typeof d?.URL === "string" ? d.URL : undefined;
      mediaType =
        typeof d?.mimetype === "string"
          ? d.mimetype
          : typeof d?.mimeType === "string"
            ? d.mimeType
            : "application/octet-stream";
      const cap = typeof d?.caption === "string" ? d.caption : undefined;
      const fileName = typeof d?.fileName === "string" ? d.fileName : undefined;
      if (cap) bodyText = cap;
      else if (fileName) bodyText = fileName;
    }

    const evolutionWebMessage =
      type !== "TEXT" && base64
        ? ({
            base64,
            mimetype: mediaType || "application/octet-stream",
            fileName: type === "DOCUMENT" ? bodyText : undefined,
          } as Record<string, unknown>)
        : undefined;

    const base: IncomingMessage = {
      from,
      waMessageId,
      type,
      body: bodyText,
      mediaUrl,
      mediaType,
      timestamp,
      ...(isGroup ? {} : { pushName }),
      ...(evolutionWebMessage ? { evolutionWebMessage } : {}),
    };

    if (isGroup) {
      return {
        messages: [
          {
            ...base,
            isGroup: true,
            groupJid,
            participantE164: participantE164 ?? null,
            participantPushName: pushName ?? null,
          },
        ],
        statusUpdates: [],
      };
    }

    return { messages: [base], statusUpdates: [] };
  }

  validateWebhookSignature(
    headers: Record<string, string | undefined>,
    rawBody: string,
    secret: string,
  ): boolean {
    const timingEqual = (a: string, b: string): boolean => {
      if (a.length !== b.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
      } catch {
        return false;
      }
    };

    const token = headers["x-openconduit-token"];
    if (token && timingEqual(token, secret)) return true;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      return false;
    }
    const env = asRecord(parsed);
    const it = typeof env?.instanceToken === "string" ? env.instanceToken.trim() : "";
    if (it) {
      if (timingEqual(it, secret)) return true;
      if (this.apiKey && timingEqual(it, this.apiKey)) return true;
    }
    return false;
  }

  handleVerification(_query: Record<string, string>): string | null {
    return null;
  }

  async healthCheck(): Promise<boolean> {
    const st = await evolutionGoGetStatus({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      instanceRef: this.instanceId,
    });
    return st ? st.loggedIn : false;
  }

  async fetchContactProfilePictureBuffer(toE164: string): Promise<Buffer | null> {
    const number = digitsOnly(toE164);
    if (!number) return null;

    const bodies: Record<string, string>[] = [
      { number },
      { number: `${number}@s.whatsapp.net` },
      { remoteJid: `${number}@s.whatsapp.net` },
    ];

    for (const body of bodies) {
      try {
        const response = await fetch(`${this.baseUrl}/user/avatar`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ ...body, preview: "false" }),
        });
        if (!response.ok) continue;

        const ct = (response.headers.get("content-type") ?? "").toLowerCase();
        if (ct.startsWith("image/")) {
          const buf = Buffer.from(await response.arrayBuffer());
          if (buf.length >= 64 && buf.length <= 5 * 1024 * 1024) return buf;
          continue;
        }

        const raw = (await response.json()) as unknown;
        const d = asRecord(raw);
        const nested = asRecord(d?.data);
        const urlPic =
          (typeof nested?.URL === "string" ? nested.URL : undefined) ||
          (typeof nested?.url === "string" ? nested.url : undefined) ||
          (typeof d?.URL === "string" ? d.URL : undefined) ||
          (typeof d?.url === "string" ? d.url : undefined);
        if (urlPic?.trim()) {
          const fromUrl = await fetch(urlPic.trim(), {
            redirect: "follow",
            signal: AbortSignal.timeout(12_000),
          }).catch(() => null);
          if (fromUrl?.ok) {
            const buf = Buffer.from(await fromUrl.arrayBuffer());
            if (buf.length >= 64 && buf.length <= 5 * 1024 * 1024) return buf;
          }
        }

        const b64raw =
          (typeof d?.avatar === "string" ? d.avatar : null) ??
          (typeof nested?.avatar === "string" ? nested.avatar : null);
        if (!b64raw?.trim()) continue;
        const b64 = b64raw.replace(/^data:image\/\w+;base64,/, "").trim();
        const buf = Buffer.from(b64, "base64");
        if (buf.length >= 64 && buf.length <= 5 * 1024 * 1024) return buf;
      } catch {
        /* try next body */
      }
    }
    return null;
  }

  async fetchContactProfilePictureUrl(toE164: string): Promise<string | undefined> {
    const number = digitsOnly(toE164);
    if (!number) return undefined;

    const paths = this.instanceId
      ? [
          `${this.baseUrl}/chat/fetchProfilePictureUrl/${this.instanceId}`,
          `${this.baseUrl}/chat/fetchProfilePictureUrl`,
        ]
      : [`${this.baseUrl}/chat/fetchProfilePictureUrl`];

    for (const path of paths) {
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ number }),
        });
        if (!response.ok) continue;
        const raw = (await response.json()) as unknown;
        const d = asRecord(raw);
        const nested = asRecord(d?.data);
        const pic =
          (typeof d?.profilePictureUrl === "string" ? d.profilePictureUrl : null) ??
          (typeof d?.url === "string" ? d.url : null) ??
          (typeof nested?.profilePictureUrl === "string" ? nested.profilePictureUrl : null) ??
          (typeof nested?.url === "string" ? nested.url : null);
        if (pic?.trim()) return pic.trim();
      } catch {
        /* next path */
      }
    }
    return undefined;
  }
}
