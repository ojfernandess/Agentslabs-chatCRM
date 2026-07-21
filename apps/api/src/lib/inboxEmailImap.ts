import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type Attachment } from "mailparser";
import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { MessageType } from "@prisma/client";
import {
  composeEmailInboundBody,
  htmlToPlainTextForEmail,
  stripEmailQuotedContent,
} from "@openconduit/shared";
import { processChannelInboxInbound } from "./channelInboxIngest.js";
import { collectEmailThreadMessageIds } from "./emailThreadRouting.js";
import { putMessageMediaFile } from "./mediaStorage.js";
import { prisma } from "../db.js";
import {
  readEmailImapLastUid,
  resolveInboxEmailImapCredentials,
  type InboxEmailImapCredentials,
} from "./inboxEmailConfig.js";

const MAX_MESSAGES_PER_SYNC = 40;
const INITIAL_SYNC_DAYS = 14;

function normalizeEmail(value: string | undefined | null): string | null {
  const v = value?.trim().toLowerCase();
  if (!v || !v.includes("@")) return null;
  return v;
}

function extractEmailAddress(from: unknown): string | null {
  if (!from || typeof from !== "object") return null;
  if (Array.isArray(from)) {
    for (const item of from) {
      const e = extractEmailAddress(item);
      if (e) return e;
    }
    return null;
  }
  const addr = (from as { address?: unknown }).address;
  return typeof addr === "string" ? normalizeEmail(addr) : null;
}

function isOwnMessage(fromEmail: string | null, creds: InboxEmailImapCredentials): boolean {
  if (!fromEmail) return true;
  const own = new Set(
    [creds.fromAddress, creds.imapUser].map((v) => normalizeEmail(v)).filter(Boolean) as string[],
  );
  return own.has(fromEmail);
}

function extractTextBody(parsed: ParsedMail): string {
  const text = parsed.text?.trim();
  if (text) return text;
  if (typeof parsed.html === "string" && parsed.html.trim()) {
    return htmlToPlainTextForEmail(parsed.html);
  }
  return "";
}

function extractHtmlBody(parsed: ParsedMail): string | null {
  if (typeof parsed.html === "string" && parsed.html.trim()) return parsed.html.trim();
  return null;
}

function extensionForAttachment(mimetype: string | undefined, originalFilename?: string | null): string {
  const m = (mimetype ?? "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  if (map[m]) return map[m];
  const ext = originalFilename?.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "");
  if (ext && ext.length <= 8) return ext;
  return "bin";
}

function messageTypeForAttachment(mimetype: string | undefined): MessageType {
  const m = (mimetype ?? "").split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "IMAGE";
  return "DOCUMENT";
}

function normalizeCid(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/^<|>$/g, "").toLowerCase();
  return cleaned || null;
}

async function persistInboundAttachment(att: Attachment): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const content = att.content;
  if (!content || (Buffer.isBuffer(content) && content.length < 1)) return null;
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const mediaType = (att.contentType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  const ext = extensionForAttachment(mediaType, att.filename);
  const token = randomBytes(16).toString("hex");
  const filename = `${token}.${ext}`;
  const stored = await putMessageMediaFile({
    filename,
    buffer,
    contentType: mediaType || "application/octet-stream",
  });
  return { mediaUrl: stored.mediaUrl, mediaType: mediaType || "application/octet-stream" };
}

async function resolveCidImagesInHtml(
  html: string,
  attachments: Attachment[],
): Promise<{ html: string; usedCids: Set<string> }> {
  const usedCids = new Set<string>();
  const cidToUrl = new Map<string, string>();

  for (const att of attachments) {
    const cid = normalizeCid(att.cid);
    if (!cid) continue;
    if (cidToUrl.has(cid)) continue;
    if (!String(att.contentType ?? "").toLowerCase().startsWith("image/")) continue;
    const stored = await persistInboundAttachment(att);
    if (!stored) continue;
    cidToUrl.set(cid, stored.mediaUrl);
  }

  const rewritten = html.replace(
    /\b(src|background)\s*=\s*(?:"(cid:[^"]+)"|'(cid:[^']+)'|(cid:[^\s>]+))/gi,
    (_full, attr: string, d1?: string, d2?: string, d3?: string) => {
      const raw = (d1 || d2 || d3 || "").trim();
      const cid = normalizeCid(raw.replace(/^cid:/i, ""));
      if (!cid) return `${attr}=""`;
      const url = cidToUrl.get(cid);
      if (!url) return `${attr}=""`;
      usedCids.add(cid);
      return `${attr}="${url}"`;
    },
  );

  return { html: rewritten, usedCids };
}

function buildImapClient(creds: InboxEmailImapCredentials): ImapFlow {
  const secure = creds.imapPort === 993;
  return new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure,
    auth: {
      user: creds.imapUser,
      pass: creds.imapPassword,
    },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 45_000,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  });
}

export type InboxEmailImapSyncResult = {
  processed: number;
  skipped: number;
  lastUid: number;
  error?: string;
};

export async function syncInboxEmailViaImap(options: {
  organizationId: string;
  inboxId: string;
  channelConfig: unknown;
  log: FastifyBaseLogger;
  /** Reprocessa e-mails recentes (ex.: upgrade de corpo texto → HTML). */
  reprocessRecent?: boolean;
}): Promise<InboxEmailImapSyncResult> {
  const creds = resolveInboxEmailImapCredentials(options.channelConfig);
  if (!creds) {
    return { processed: 0, skipped: 0, lastUid: readEmailImapLastUid(options.channelConfig), error: "imap_not_configured" };
  }

  const lastUid = readEmailImapLastUid(options.channelConfig);
  let maxUid = lastUid;
  let processed = 0;
  let skipped = 0;

  const client = buildImapClient(creds);

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const searchQuery =
        options.reprocessRecent || lastUid <= 0
          ? { since: new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000) }
          : { uid: `${lastUid + 1}:*` };

      let uids = await client.search(searchQuery, { uid: true });
      if (!uids) {
        uids = [];
      } else if (!Array.isArray(uids)) {
        uids = [uids];
      }

      const sortedUids = [...uids]
        .map((uid) => Number(uid))
        .filter((uid) => Number.isFinite(uid) && uid > 0)
        .sort((a, b) => a - b);

      // Em reprocessamento, prioriza os mais recentes.
      const batch = options.reprocessRecent
        ? sortedUids.slice(-Math.min(MAX_MESSAGES_PER_SYNC * 2, 80))
        : sortedUids.slice(0, MAX_MESSAGES_PER_SYNC);

      for await (const msg of client.fetch(batch, { uid: true, source: true, envelope: true }, { uid: true })) {
        if (!msg.uid) continue;
        maxUid = Math.max(maxUid, msg.uid);

        if (!msg.source) {
          skipped += 1;
          continue;
        }

        const parsed = await simpleParser(msg.source);
        const fromEmail =
          extractEmailAddress(parsed.from) ||
          extractEmailAddress(msg.envelope?.from) ||
          null;

        if (isOwnMessage(fromEmail, creds)) {
          skipped += 1;
          continue;
        }
        if (!fromEmail) {
          skipped += 1;
          continue;
        }

        const messageId =
          typeof parsed.messageId === "string" && parsed.messageId.trim()
            ? parsed.messageId.trim().slice(0, 512)
            : `imap-uid:${msg.uid}`;

        const existingEmail = await prisma.message.findFirst({
          where: {
            providerMsgId: messageId,
            conversation: { organizationId: options.organizationId, inboxId: options.inboxId },
          },
          select: { id: true, body: true },
        });
        const existingHasHtml =
          Boolean(existingEmail?.body?.includes("<!--oc-email-html-->"));
        if (existingEmail && existingHasHtml) {
          skipped += 1;
          continue;
        }
        const needsHtmlUpgrade = Boolean(existingEmail && !existingHasHtml);

        const participantName =
          typeof parsed.from === "object" && parsed.from && !Array.isArray(parsed.from)
            ? (parsed.from as { name?: string }).name?.trim() || fromEmail
            : fromEmail;

        const textBody = extractTextBody(parsed);
        let htmlBody = extractHtmlBody(parsed);
        const emailThreadMessageIds = collectEmailThreadMessageIds(parsed.inReplyTo, parsed.references);
        const inboundAttachments = (parsed.attachments ?? []).filter(
          (att) => att.content && (!Buffer.isBuffer(att.content) || att.content.length > 0),
        );

        const baseInbound = {
          organizationId: options.organizationId,
          inboxId: options.inboxId,
          channelType: "EMAIL" as const,
          participantId: fromEmail,
          participantName,
          email: fromEmail,
          emailThreadMessageIds,
          log: options.log,
        };

        let usedInlineCids = new Set<string>();
        if (htmlBody && (!existingEmail || needsHtmlUpgrade)) {
          const resolved = await resolveCidImagesInHtml(htmlBody, inboundAttachments);
          htmlBody = resolved.html;
          usedInlineCids = resolved.usedCids;
        }

        const cleanedText = stripEmailQuotedContent(textBody.trim());
        let imported = false;

        if (htmlBody || cleanedText || inboundAttachments.length === 0) {
          const result = await processChannelInboxInbound({
            ...baseInbound,
            body: htmlBody
              ? composeEmailInboundBody(parsed.subject, htmlBody, { html: true })
              : composeEmailInboundBody(parsed.subject, textBody),
            type: "TEXT",
            externalMessageId: messageId,
          });
          if (result.accepted) imported = true;
        }

        if (existingEmail && !needsHtmlUpgrade) {
          if (imported) processed += 1;
          else skipped += 1;
          continue;
        }

        for (let i = 0; i < inboundAttachments.length; i += 1) {
          const att = inboundAttachments[i]!;
          const cid = normalizeCid(att.cid);
          // Imagens inline (CID) já embutidas no HTML — não duplicar como anexo separado.
          if (cid && usedInlineCids.has(cid)) continue;
          // related/inline sem CID usado no HTML: ainda assim evita spam de logos se related
          if (att.related && cid && htmlBody) continue;

          const stored = await persistInboundAttachment(att);
          if (!stored) {
            skipped += 1;
            continue;
          }
          const attName = att.filename?.trim() || undefined;
          const result = await processChannelInboxInbound({
            ...baseInbound,
            body: attName ?? composeEmailInboundBody(parsed.subject, textBody),
            type: messageTypeForAttachment(att.contentType),
            mediaUrl: stored.mediaUrl,
            mediaType: stored.mediaType,
            externalMessageId: `${messageId}#att-${i}`,
          });
          if (result.accepted) imported = true;
        }

        if (imported) processed += 1;
        else skipped += 1;
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.log.warn({ err, inboxId: options.inboxId }, "IMAP sync failed");
    return { processed, skipped, lastUid: maxUid, error: message.slice(0, 240) };
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore logout errors */
    }
  }

  return { processed, skipped, lastUid: maxUid };
}
