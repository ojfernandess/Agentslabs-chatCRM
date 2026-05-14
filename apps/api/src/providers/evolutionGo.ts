import crypto from "node:crypto";
import {
  WhatsAppProviderInterface,
  SendMessageParams,
  IncomingMessage,
  StatusUpdate,
} from "./types.js";
import { evolutionGoFetchAllInstances } from "../lib/evolutionGoApi.js";

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
  private instanceId: string;

  constructor(baseUrl: string, apiKey: string, instanceId: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.instanceId = instanceId;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.apiKey,
      instanceId: this.instanceId,
      "Content-Type": "application/json",
      ...(extra ?? {}),
    };
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    if (params.type === "TEXT") {
      const url = `${this.baseUrl}/send/text`;
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          number: destinationForSend(params.to),
          text: params.body ?? "",
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

  parseWebhook(headers: Record<string, string | undefined>, body: unknown) {
    const env = asRecord(body);
    const event = typeof env?.event === "string" ? env.event.trim() : "";

    if (event === "Receipt") {
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

    if (event !== "Message") {
      return { messages: [], statusUpdates: [] };
    }

    const data = asRecord(env?.data);
    const info = asRecord(data?.Info ?? data?.info);
    if (!info) return { messages: [], statusUpdates: [] };
    if (info.IsFromMe === true) return { messages: [], statusUpdates: [] };

    const waMessageId = typeof info.ID === "string" && info.ID.trim() ? info.ID.trim() : "";
    if (!waMessageId) return { messages: [], statusUpdates: [] };

    const remoteJid = typeof info.Chat === "string" ? info.Chat.trim() : "";
    const senderJid = typeof info.Sender === "string" ? info.Sender.trim() : "";
    const senderAlt = typeof info.SenderAlt === "string" ? info.SenderAlt.trim() : "";
    const isGroup = info.IsGroup === true || remoteJid.includes("@g.us");

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
      from = jidOrAltToE164(remoteJid, senderAlt) ?? jidOrAltToE164(senderJid, senderAlt);
      if (!from) return { messages: [], statusUpdates: [] };
    }

    const pushName = typeof info.PushName === "string" && info.PushName.trim() ? info.PushName.trim() : undefined;
    const timestamp = parseIsoOrNow(info.Timestamp);

    const msg = asRecord(data?.Message ?? data?.message) ?? {};
    let type = "TEXT";
    let bodyText: string | undefined;
    let mediaUrl: string | undefined;
    let mediaType: string | undefined;

    const conv = typeof msg.conversation === "string" ? msg.conversation : undefined;
    const ext = asRecord(msg.extendedTextMessage);
    const extText = ext && typeof ext.text === "string" ? ext.text : undefined;
    bodyText = extText ?? conv;

    const mediaTypeHint = typeof info.MediaType === "string" ? info.MediaType.trim().toLowerCase() : "";
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
    const token = headers["x-openconduit-token"];
    if (token) {
      if (token.length !== secret.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
      } catch {
        return false;
      }
    }
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      const env = asRecord(parsed);
      const it = typeof env?.instanceToken === "string" ? env.instanceToken : "";
      if (!it || it.length !== secret.length) return false;
      return crypto.timingSafeEqual(Buffer.from(it), Buffer.from(secret));
    } catch {
      return false;
    }
  }

  handleVerification(_query: Record<string, string>): string | null {
    return null;
  }

  async healthCheck(): Promise<boolean> {
    const r = await evolutionGoFetchAllInstances({ baseUrl: this.baseUrl, apiKey: this.apiKey });
    if (!r) return false;
    const hit = r.find((x) => x.id === this.instanceId || x.name === this.instanceId);
    return hit ? hit.connected : false;
  }
}
