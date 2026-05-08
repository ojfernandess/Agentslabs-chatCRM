import crypto from "node:crypto";
import {
  WhatsAppProviderInterface,
  SendMessageParams,
  IncomingMessage,
  StatusUpdate,
  ContactSyncPatch,
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

/** Tenta obter E.164 a partir do JID principal ou do alternativo (Baileys LID / `@lid`). */
function jidOrAltToE164(remoteJid: string, remoteJidAlt: string): string | null {
  return jidToE164(remoteJid) ?? (remoteJidAlt ? jidToE164(remoteJidAlt) : null);
}

/** E.164 sintético +888 + 12 dígitos — um contacto por grupo (Evolution @g.us). */
function groupJidToSyntheticE164(remoteJid: string): string | null {
  const local = remoteJid.split("@")[0]?.trim() ?? "";
  const d = local.replace(/\D/g, "");
  if (!d) return null;
  const twelve = (d + "000000000000").slice(0, 12);
  return `+888${twelve}`;
}

/** Destino Evolution: JID de grupo ou apenas dígitos para chat individual. */
function evolutionDestinationForApi(to: string): string {
  const t = to.trim();
  if (t.includes("@g.us")) {
    const local = t.split("@")[0]?.trim() ?? "";
    if (!local) throw new Error("Evolution API: invalid group JID");
    return `${local}@g.us`;
  }
  const number = digitsOnly(t);
  if (!number) throw new Error("Evolution API: invalid destination number");
  return number;
}

function normalizeEvolutionEvent(event: string | undefined): string {
  if (!event) return "";
  return event.trim().toLowerCase().replace(/_/g, ".");
}

/** Evolution `webhook_base64: true`: campo `data` como string base64 com JSON interno. */
function decodeEvolutionWebhookBodyIfNeeded(body: unknown): unknown {
  const env = asRecord(body);
  if (!env) return body;
  const raw = env.data;
  if (typeof raw !== "string" || raw.length < 24) return body;
  const compact = raw.replace(/\s/g, "");
  if (compact.length < 24 || !/^[A-Za-z0-9+/]+=*$/.test(compact)) return body;
  try {
    const decoded = Buffer.from(compact, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    return { ...env, data: parsed };
  } catch {
    return body;
  }
}

function collectUpsertRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((x) => collectUpsertRecords(x));
  }
  const dataObj = asRecord(raw);
  if (!dataObj) return [];

  const nestedOuter = asRecord(dataObj.data);
  if (nestedOuter && nestedOuter.key == null && nestedOuter.message == null && !Array.isArray(nestedOuter.messages)) {
    const deep = asRecord(nestedOuter.data);
    if (deep && (deep.key != null || deep.message != null || Array.isArray(deep.messages))) {
      return collectUpsertRecords(deep);
    }
  }

  const messages = dataObj.messages;
  if (Array.isArray(messages)) {
    return messages.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  const singleMsg = asRecord(messages);
  if (singleMsg !== null && (singleMsg.key !== undefined || singleMsg.message !== undefined)) {
    return [singleMsg];
  }
  /* Evolution v2: por vezes a mensagem vem em `data.message` (objeto único). */
  const nestedMsg = asRecord(dataObj.message);
  if (nestedMsg !== null && (nestedMsg.key !== undefined || nestedMsg.message !== undefined)) {
    return [nestedMsg];
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
  if (!remoteJid) return null;

  const waMessageId = key.id != null && key.id !== "" ? String(key.id) : "";
  if (!waMessageId) return null;

  const participantJid =
    typeof key.participant === "string" && key.participant.trim()
      ? String(key.participant).trim()
      : "";
  const participantAlt =
    typeof key.participantAlt === "string" && key.participantAlt.trim()
      ? String(key.participantAlt).trim()
      : "";
  const remoteJidAlt =
    typeof key.remoteJidAlt === "string" && key.remoteJidAlt.trim()
      ? String(key.remoteJidAlt).trim()
      : "";
  const pushFromEnvelope =
    (typeof rec.pushName === "string" && rec.pushName.trim()) ||
    (typeof key.pushName === "string" && key.pushName.trim()) ||
    undefined;

  let phone: string | null = null;
  let isGroup = false;
  let groupJid: string | undefined;
  let participantE164: string | null | undefined;
  let participantPushName: string | undefined;

  if (remoteJid.includes("@g.us")) {
    phone = groupJidToSyntheticE164(remoteJid);
    if (!phone) return null;
    isGroup = true;
    groupJid = remoteJid;
    if (participantJid) {
      participantE164 = jidOrAltToE164(participantJid, participantAlt);
    } else {
      participantE164 = null;
    }
    participantPushName = pushFromEnvelope;
  } else {
    phone = jidOrAltToE164(remoteJid, remoteJidAlt);
    if (!phone && fallbackDigits) {
      const d = digitsOnly(fallbackDigits);
      if (d.length >= 7 && d.length <= 15) {
        phone = `+${d}`;
      }
    }
    if (!phone) return null;
  }

  const pushName = isGroup ? undefined : pushFromEnvelope;

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
  const doc = asRecord(message.documentMessage);
  const audio = asRecord(message.audioMessage);
  const video = asRecord(message.videoMessage);

  if (img?.url) {
    type = "IMAGE";
    mediaUrl = String(img.url);
    mediaType = typeof img.mimetype === "string" ? img.mimetype : "image/jpeg";
    if (typeof img.caption === "string") body = img.caption;
  } else if (doc?.url) {
    type = "DOCUMENT";
    mediaUrl = String(doc.url);
    mediaType = typeof doc.mimetype === "string" ? doc.mimetype : "application/octet-stream";
    if (typeof doc.caption === "string") body = doc.caption;
    else if (typeof doc.fileName === "string") body = doc.fileName;
  } else if (audio) {
    type = "AUDIO";
    if (typeof audio.url === "string" && audio.url.trim()) {
      mediaUrl = String(audio.url);
    }
    mediaType = typeof audio.mimetype === "string" ? audio.mimetype : "audio/ogg";
  } else if (video?.url) {
    type = "VIDEO";
    mediaUrl = String(video.url);
    mediaType = typeof video.mimetype === "string" ? video.mimetype : "video/mp4";
    if (typeof video.caption === "string") body = video.caption;
  }

  const evolutionWebMessage =
    type === "IMAGE" || type === "DOCUMENT" || type === "AUDIO" || type === "VIDEO" ? rec : undefined;

  const base: IncomingMessage = {
    from: phone,
    waMessageId,
    type,
    body,
    mediaUrl,
    mediaType,
    timestamp: parseTimestamp(rec.messageTimestamp),
    pushName,
    ...(evolutionWebMessage ? { evolutionWebMessage } : {}),
  };

  if (isGroup) {
    return {
      ...base,
      isGroup: true,
      groupJid,
      participantE164: participantE164 ?? null,
      participantPushName: participantPushName ?? null,
    };
  }

  return base;
}

function mapEvolutionReceiptStatus(
  s: string,
): StatusUpdate["status"] | null {
  const v = s.trim();
  if (/^\d+$/.test(v)) {
    const n = parseInt(v, 10);
    if (n === 0) return "FAILED";
    if (n === 1) return "SENT";
    if (n === 2) return "SENT";
    if (n === 3) return "DELIVERED";
    if (n === 4) return "READ";
    if (n === 5) return "READ";
    return null;
  }
  const u = v.toUpperCase();
  if (u === "READ") return "READ";
  if (u === "DELIVERY_ACK" || u === "DELIVERED") return "DELIVERED";
  if (u === "SERVER_ACK" || u === "SENT") return "SENT";
  if (u === "ERROR" || u === "FAILED" || u === "DELETED") return "FAILED";
  if (u === "PENDING") return "SENT";
  return null;
}

function collectUpdateRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((x) => collectUpdateRecords(x));
  }
  const one = asRecord(raw);
  if (!one) return [];

  const nested = asRecord(one.data);
  if (nested && nested.key == null && nested.update == null && !Array.isArray(nested.messages)) {
    const deep = asRecord(nested.data);
    if (deep && (deep.key != null || deep.update != null || Array.isArray(deep.messages))) {
      return collectUpdateRecords(deep);
    }
  }

  const messages = one.messages;
  if (Array.isArray(messages)) {
    return messages.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  const singleMsg = asRecord(messages);
  if (singleMsg !== null && (singleMsg.key !== undefined || singleMsg.update !== undefined)) {
    return [singleMsg];
  }
  if (one.key !== undefined || one.update !== undefined || one.message !== undefined) {
    return [one];
  }
  return [];
}

function parseUpdatesToStatus(raw: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  for (const rec of collectUpdateRecords(raw)) {
    const key = asRecord(rec.key);
    const waMessageId = key ? String(key.id ?? "") : "";
    if (!waMessageId) continue;
    const update = asRecord(rec.update);
    let statusRaw = "";
    if (update) {
      if (typeof update.status === "string") statusRaw = update.status;
      else if (typeof update.status === "number") statusRaw = String(update.status);
    }
    if (!statusRaw && typeof rec.status === "number") statusRaw = String(rec.status);
    if (!statusRaw && typeof rec.status === "string") statusRaw = rec.status;
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

function extractEvolutionSendMessageId(raw: unknown): string | undefined {
  const keyId = (o: unknown): string | undefined => {
    const k = asRecord(o);
    if (!k) return undefined;
    const id = k.id;
    if (typeof id === "string" && id.length > 0) return id;
    if (typeof id === "number" && Number.isFinite(id)) return String(Math.trunc(id));
    return undefined;
  };

  const tryOrder = (obj: Record<string, unknown> | null): string | undefined => {
    if (!obj) return undefined;
    const a = keyId(obj.key);
    if (a) return a;
    const data = asRecord(obj.data);
    if (data) {
      const b = keyId(data.key);
      if (b) return b;
      const msg = asRecord(data.message);
      if (msg) {
        const c = keyId(msg.key);
        if (c) return c;
      }
    }
    const msgT = asRecord(obj.message);
    if (msgT) {
      const d0 = keyId(msgT.key);
      if (d0) return d0;
    }
    for (const k of ["messageId", "whatsappMessageId"] as const) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return undefined;
  };

  const d = asRecord(raw);
  if (!d) return undefined;
  let id = tryOrder(d);
  if (id) return id;
  for (const nest of ["data", "result", "response", "value"] as const) {
    const sub = asRecord(d[nest]);
    if (sub) {
      id = tryOrder(sub);
      if (id) return id;
    }
  }
  if (Array.isArray(raw)) {
    for (const el of raw) {
      id = extractEvolutionSendMessageId(el);
      if (id) return id;
    }
  }
  return undefined;
}

function collectContactRecords(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
  }
  const one = asRecord(raw);
  return one ? [one] : [];
}

function pickProfilePictureUrl(r: Record<string, unknown>): string | undefined {
  const u =
    (typeof r.profilePictureUrl === "string" && r.profilePictureUrl) ||
    (typeof r.profilePicUrl === "string" && r.profilePicUrl) ||
    (typeof r.imgUrl === "string" && r.imgUrl) ||
    undefined;
  if (u) return u;
  const img = asRecord(r.imgUrl);
  if (img && typeof img.url === "string") return img.url;
  return undefined;
}

function parseEvolutionContactSync(body: unknown): ContactSyncPatch[] {
  const env = asRecord(body);
  if (!env) return [];
  const event = normalizeEvolutionEvent(typeof env.event === "string" ? env.event : undefined);
  if (event !== "contacts.update" && event !== "contacts.upsert" && event !== "contacts.set") {
    return [];
  }
  const out: ContactSyncPatch[] = [];
  for (const r of collectContactRecords(env.data)) {
    const jidRaw =
      (typeof r.id === "string" && r.id) ||
      (typeof r.remoteJid === "string" && r.remoteJid) ||
      "";
    const phone = jidToE164(jidRaw);
    if (!phone) continue;
    const pic = pickProfilePictureUrl(r);
    const waDisplayName =
      (typeof r.notify === "string" && r.notify.trim()) ||
      (typeof r.name === "string" && r.name.trim()) ||
      (typeof r.verifiedName === "string" && r.verifiedName.trim()) ||
      undefined;
    out.push({
      phone,
      profilePictureUrl: pic ?? null,
      waDisplayName: waDisplayName ?? null,
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
    const number = evolutionDestinationForApi(params.to);

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
      const data = (await response.json()) as unknown;
      const id = extractEvolutionSendMessageId(data);
      if (!id) throw new Error("Evolution API: missing message id in response");
      return id;
    }

    if (params.type === "AUDIO") {
      if (!params.mediaUrl) {
        throw new Error("Evolution API: mediaUrl required for audio messages");
      }
      const urlAudio = `${this.baseUrl}/message/sendWhatsAppAudio/${this.instanceName}`;
      /** Evolution v1: audioMessage + options. v2: root-level `audio`. */
      const v1Body = {
        number,
        audioMessage: { audio: params.mediaUrl, ptt: true },
        options: { presence: "recording", encoding: true },
      };
      const v2Body = { number, audio: params.mediaUrl };

      const postAudio = async (body: Record<string, unknown>) => {
        const res = await fetch(urlAudio, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
        });
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          /* body may be empty */
        }
        return { res, json };
      };

      let { res: responseAudio, json: dataAudio } = await postAudio(v1Body);
      let idA = extractEvolutionSendMessageId(dataAudio);

      if (!responseAudio.ok) {
        const second = await postAudio(v2Body);
        responseAudio = second.res;
        dataAudio = second.json;
        idA = extractEvolutionSendMessageId(dataAudio);
      }

      if (!responseAudio.ok) {
        const err =
          dataAudio !== null && typeof dataAudio === "object"
            ? JSON.stringify(dataAudio)
            : await responseAudio.text().catch(() => "");
        throw new Error(`Evolution API error (audio): ${responseAudio.status} ${err}`);
      }
      if (!idA) throw new Error("Evolution API: missing message id in audio response");
      return idA;
    }

    if (!params.mediaUrl) {
      throw new Error("Evolution API: mediaUrl required for media messages");
    }

    const { mediatype, mimetype, fileName } = mergeEvolutionMeta(
      params.type,
      params.mediaUrl,
      params.mediaType,
    );

    const mediaMessage: Record<string, unknown> = {
      mediaType: mediatype,
      media: params.mediaUrl,
    };
    if (mimetype) mediaMessage.mimetype = mimetype;
    if (params.type === "DOCUMENT" && fileName) {
      mediaMessage.fileName = fileName;
    }
    const cap = params.body?.trim();
    if (params.type !== "AUDIO" && cap) {
      mediaMessage.caption = cap;
    }

    const url = `${this.baseUrl}/message/sendMedia/${this.instanceName}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        number,
        mediaMessage,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Evolution API error: ${response.status} ${err}`);
    }
    const data = (await response.json()) as unknown;
    const id = extractEvolutionSendMessageId(data);
    if (!id) throw new Error("Evolution API: missing message id in response");
    return id;
  }

  parseWebhook(
    _headers: Record<string, string | undefined>,
    body: unknown,
  ) {
    const decoded = decodeEvolutionWebhookBodyIfNeeded(body);
    const env = asRecord(decoded);
    let event = normalizeEvolutionEvent(
      typeof env?.event === "string" ? env.event : undefined,
    );
    if (!event && typeof env?.type === "string") {
      event = normalizeEvolutionEvent(env.type);
    }

    const senderRaw =
      typeof env?.sender === "string"
        ? env.sender
        : typeof env?.sender === "number"
          ? String(env.sender)
          : null;

    let upsertRecords = collectUpsertRecords(env?.data);
    if (event === "messages.upsert" && upsertRecords.length === 0 && env) {
      upsertRecords = collectUpsertRecords(env);
    }

    if (event === "messages.upsert") {
      const messages: IncomingMessage[] = [];
      for (const rec of upsertRecords) {
        const msg = parseUpsertToIncoming(rec, senderRaw);
        if (msg) messages.push(msg);
      }
      return { messages, statusUpdates: [], contactSync: parseEvolutionContactSync(decoded) };
    }

    if (event === "messages.update") {
      const fallbackMessages: IncomingMessage[] = [];
      let updateRecords = collectUpsertRecords(env?.data);
      if (updateRecords.length === 0 && env) {
        updateRecords = collectUpsertRecords(env);
      }
      for (const rec of updateRecords) {
        const msg = parseUpsertToIncoming(rec, senderRaw);
        if (msg) fallbackMessages.push(msg);
      }
      return {
        messages: fallbackMessages,
        statusUpdates: parseUpdatesToStatus(env?.data),
        contactSync: parseEvolutionContactSync(decoded),
      };
    }

    const contactSync = parseEvolutionContactSync(decoded);
    if (contactSync.length > 0) {
      return { messages: [], statusUpdates: [], contactSync };
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

  async fetchContactProfilePictureUrl(toE164: string): Promise<string | undefined> {
    const number = digitsOnly(toE164);
    if (!number) return undefined;
    try {
      const url = `${this.baseUrl}/chat/fetchProfilePictureUrl/${this.instanceName}`;
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ number }),
      });
      if (!response.ok) return undefined;
      const raw = (await response.json()) as unknown;
      const d = asRecord(raw);
      if (!d) return undefined;
      const pic =
        (typeof d.profilePictureUrl === "string" && d.profilePictureUrl) ||
        (typeof d.url === "string" && d.url) ||
        (typeof d.profilePicUrl === "string" && d.profilePicUrl);
      return pic || undefined;
    } catch {
      return undefined;
    }
  }
}

export async function evolutionCreateBusinessTemplate(options: {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  name: string;
  category: string;
  language: string;
  body: string;
  footer?: string;
}): Promise<unknown> {
  const base = normalizeBaseUrl(options.baseUrl);
  const instance = encodeURIComponent(options.instanceName);
  const url = `${base}/template/create/${instance}`;
  const components: Array<Record<string, unknown>> = [{ type: "BODY", text: options.body }];
  if (options.footer?.trim()) {
    components.push({ type: "FOOTER", text: options.footer.trim() });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: options.name,
      category: options.category,
      language: options.language,
      components,
    }),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`Evolution template/create: ${res.status} ${txt}`);
  }
  try {
    return JSON.parse(txt) as unknown;
  } catch {
    return { raw: txt };
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
