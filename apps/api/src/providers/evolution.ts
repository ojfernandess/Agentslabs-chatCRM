import crypto from "node:crypto";
import {
  WhatsAppProviderInterface,
  SendMessageParams,
  IncomingMessage,
  StatusUpdate,
} from "./types.js";

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

function unwrapInnerMessage(m: Record<string, unknown>): Record<string, unknown> {
  const ephemeral = asRecord(m.ephemeralMessage);
  if (ephemeral) {
    const inner = asRecord(ephemeral.message);
    if (inner) return inner;
  }
  for (const wrap of ["viewOnceMessage", "viewOnceMessageV2"] as const) {
    const w = asRecord(m[wrap]);
    if (w) {
      const inner = asRecord(w.message);
      if (inner) return inner;
    }
  }
  const docCap = asRecord(m.documentWithCaptionMessage);
  if (docCap) {
    const inner = asRecord(docCap.message);
    if (inner) return inner;
  }
  return m;
}

function jidToE164(remoteJid: string): string | null {
  if (!remoteJid || remoteJid.includes("@g.us")) return null;
  let localPart = remoteJid.split("@")[0];
  /* Baileys: "5511999999999:45@s.whatsapp.net" — phone is before ":" */
  if (localPart.includes(":")) {
    localPart = localPart.split(":")[0] ?? localPart;
  }
  if (!localPart || !/^\d+$/.test(localPart)) return null;
  return `+${localPart}`;
}

function normalizeEvolutionEvent(event: string | undefined): string {
  if (!event) return "";
  return event.trim().toLowerCase().replace(/_/g, ".");
}

function collectUpsertRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  const dataObj = asRecord(raw);
  if (!dataObj) return [];
  const messages = dataObj.messages;
  if (Array.isArray(messages)) {
    return messages.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  const singleMsg = asRecord(messages);
  if (singleMsg !== null && (singleMsg.key !== undefined || singleMsg.message !== undefined)) {
    return [singleMsg];
  }
  if (dataObj.key !== undefined || dataObj.message !== undefined) {
    return [dataObj];
  }
  return [];
}

function parseTimestamp(ts: unknown): Date {
  if (typeof ts === "number") return new Date(ts * (ts < 2e12 ? 1000 : 1));
  if (typeof ts === "string") {
    const n = parseInt(ts, 10);
    if (!Number.isNaN(n)) return new Date(n * (n < 2e12 ? 1000 : 1));
  }
  return new Date();
}

function parseUpsertToIncoming(
  rec: Record<string, unknown>,
  fallbackDigits?: string | null,
): IncomingMessage | null {
  const key = asRecord(rec.key);
  if (!key) return null;
  if (key.fromMe === true) return null;
  const remoteJid = String(key.remoteJid ?? "");
  let phone = jidToE164(remoteJid);
  if (!phone && fallbackDigits) {
    const d = digitsOnly(fallbackDigits);
    if (d.length >= 7 && d.length <= 15) {
      phone = `+${d}`;
    }
  }
  if (!phone) return null;
  const waMessageId = String(key.id ?? "");
  if (!waMessageId) return null;

  const message = unwrapInnerMessage(asRecord(rec.message) ?? {});
  let body: string | undefined;
  let type = "TEXT";
  let mediaUrl: string | undefined;
  let mediaType: string | undefined;

  if (typeof message.conversation === "string") {
    body = message.conversation;
  }
  const extended = asRecord(message.extendedTextMessage);
  if (extended && typeof extended.text === "string") {
    body = extended.text;
  }

  const img = asRecord(message.imageMessage);
  if (img?.url) {
    type = "IMAGE";
    mediaUrl = String(img.url);
    mediaType = typeof img.mimetype === "string" ? img.mimetype : "image/jpeg";
    if (typeof img.caption === "string") body = img.caption;
  }

  const doc = asRecord(message.documentMessage);
  if (doc?.url) {
    type = "DOCUMENT";
    mediaUrl = String(doc.url);
    mediaType = typeof doc.mimetype === "string" ? doc.mimetype : "application/octet-stream";
    if (typeof doc.caption === "string") body = doc.caption;
    else if (typeof doc.fileName === "string") body = doc.fileName;
  }

  const audio = asRecord(message.audioMessage);
  if (audio?.url) {
    type = "AUDIO";
    mediaUrl = String(audio.url);
    mediaType = typeof audio.mimetype === "string" ? audio.mimetype : "audio/mpeg";
  }

  const video = asRecord(message.videoMessage);
  if (video?.url) {
    type = "VIDEO";
    mediaUrl = String(video.url);
    mediaType = typeof video.mimetype === "string" ? video.mimetype : "video/mp4";
    if (typeof video.caption === "string") body = video.caption;
  }

  return {
    from: phone,
    waMessageId,
    type,
    body,
    mediaUrl,
    mediaType,
    timestamp: parseTimestamp(rec.messageTimestamp),
  };
}

function mapEvolutionReceiptStatus(
  s: string,
): StatusUpdate["status"] | null {
  const v = s.toUpperCase();
  if (v === "READ") return "READ";
  if (v === "DELIVERY_ACK" || v === "DELIVERED") return "DELIVERED";
  if (v === "SERVER_ACK" || v === "SENT") return "SENT";
  if (v === "ERROR" || v === "FAILED" || v === "DELETED") return "FAILED";
  return null;
}

function collectUpdateRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  const one = asRecord(raw);
  return one ? [one] : [];
}

function parseUpdatesToStatus(raw: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const rec of collectUpdateRecords(raw)) {
    const key = asRecord(rec.key);
    const waMessageId = key ? String(key.id ?? "") : "";
    if (!waMessageId) continue;
    const update = asRecord(rec.update);
    if (!update) continue;
    const statusRaw =
      typeof update.status === "string"
        ? update.status
        : typeof update.status === "number"
          ? String(update.status)
          : "";
    const status = mapEvolutionReceiptStatus(statusRaw);
    if (!status) continue;
    out.push({
      waMessageId,
      status,
      timestamp: new Date(),
    });
  }
  return out;
}

export class EvolutionApiProvider implements WhatsAppProviderInterface {
  private baseUrl: string;
  private apiKey: string;
  private instanceName: string;

  constructor(baseUrl: string, apiKey: string, instanceName: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.instanceName = encodeURIComponent(instanceName);
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    const number = digitsOnly(params.to);
    if (!number) {
      throw new Error("Evolution API: invalid destination number");
    }

    if (params.type === "TEXT" || params.type === "TEMPLATE") {
      const text = params.body ?? (params.type === "TEMPLATE" ? "" : "");
      if (!text.trim()) {
        throw new Error("Evolution API: text body required");
      }
      const url = `${this.baseUrl}/message/sendText/${this.instanceName}`;
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ number, text }),
      });
      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Evolution API error: ${response.status} ${err}`);
      }
      const data = (await response.json()) as { key?: { id?: string } };
      const id = data.key?.id;
      if (!id) throw new Error("Evolution API: missing message id in response");
      return id;
    }

    if (!params.mediaUrl) {
      throw new Error("Evolution API: mediaUrl required for media messages");
    }

    const { mediatype, mimetype, fileName } = mergeEvolutionMeta(
      params.type,
      params.mediaUrl,
      params.mediaType,
    );

    const url = `${this.baseUrl}/message/sendMedia/${this.instanceName}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        number,
        mediatype,
        mimetype,
        caption: params.body ?? "",
        media: params.mediaUrl,
        fileName,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Evolution API error: ${response.status} ${err}`);
    }
    const data = (await response.json()) as { key?: { id?: string } };
    const id = data.key?.id;
    if (!id) throw new Error("Evolution API: missing message id in response");
    return id;
  }

  parseWebhook(
    _headers: Record<string, string | undefined>,
    body: unknown,
  ): { messages: IncomingMessage[]; statusUpdates: StatusUpdate[] } {
    const env = asRecord(body);
    let event = normalizeEvolutionEvent(
      typeof env?.event === "string" ? env.event : undefined,
    );

    const senderRaw =
      typeof env?.sender === "string"
        ? env.sender
        : typeof env?.sender === "number"
          ? String(env.sender)
          : null;

    const upsertRecords = collectUpsertRecords(env?.data);

    if (event === "messages.upsert") {
      const messages: IncomingMessage[] = [];
      for (const rec of upsertRecords) {
        const msg = parseUpsertToIncoming(rec, senderRaw);
        if (msg) messages.push(msg);
      }
      return { messages, statusUpdates: [] };
    }

    if (event === "messages.update") {
      return {
        messages: [],
        statusUpdates: parseUpdatesToStatus(env?.data),
      };
    }

    return { messages: [], statusUpdates: [] };
  }

  validateWebhookSignature(
    headers: Record<string, string | undefined>,
    _rawBody: string,
    secret: string,
  ): boolean {
    const token = headers["x-openconduit-token"];
    if (!token || token.length !== secret.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
    } catch {
      return false;
    }
  }

  handleVerification(_query: Record<string, string>): string | null {
    return null;
  }

  async healthCheck(): Promise<boolean> {
    const url = `${this.baseUrl}/instance/connectionState/${this.instanceName}`;
    const response = await fetch(url, { headers: { apikey: this.apiKey } });
    if (!response.ok) return false;
    const data = (await response.json()) as {
      instance?: { state?: string };
      state?: string;
    };
    const state = (data.instance?.state ?? data.state)?.toLowerCase();
    return state === "open";
  }
}

function mimetypeFromFilename(fileName: string, fallback: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    webm: "audio/webm",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    mp4: "audio/mp4",
    m4a: "audio/mp4",
    amr: "audio/amr",
    wav: "audio/wav",
    wave: "audio/wav",
  };
  return map[ext] ?? fallback;
}

function mergeEvolutionMeta(
  type: string,
  mediaUrl: string,
  explicitMime?: string,
): { mediatype: string; mimetype: string; fileName: string } {
  const base = evolutionMediaMeta(type, mediaUrl);
  const raw = explicitMime?.trim();
  if (!raw) return base;
  const mimetype = raw.split(";")[0].trim().toLowerCase();
  let mediatype = base.mediatype;
  if (mimetype.startsWith("image/")) mediatype = "image";
  else if (mimetype.startsWith("video/")) mediatype = "video";
  else if (mimetype.startsWith("audio/")) mediatype = "audio";
  else mediatype = "document";
  return { ...base, mimetype, mediatype };
}

function evolutionMediaMeta(
  type: string,
  mediaUrl: string,
): { mediatype: string; mimetype: string; fileName: string } {
  let fileName = "attachment";
  try {
    const path = new URL(mediaUrl).pathname;
    const last = path.split("/").pop();
    if (last) fileName = decodeURIComponent(last.split("?")[0]);
  } catch {
    // keep default
  }

  switch (type) {
    case "IMAGE":
      return { mediatype: "image", mimetype: "image/jpeg", fileName };
    case "VIDEO":
      return { mediatype: "video", mimetype: "video/mp4", fileName };
    case "AUDIO":
      return {
        mediatype: "audio",
        mimetype: mimetypeFromFilename(fileName, "audio/mpeg"),
        fileName,
      };
    case "DOCUMENT":
    default:
      return { mediatype: "document", mimetype: "application/octet-stream", fileName };
  }
}
