import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { FastifyBaseLogger } from "fastify";
import { processChannelInboxInbound } from "./channelInboxIngest.js";
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

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTextBody(parsed: ParsedMail): string {
  const text = parsed.text?.trim();
  if (text) return text;
  if (typeof parsed.html === "string" && parsed.html.trim()) {
    return htmlToPlainText(parsed.html);
  }
  return "";
}

function composeInboundBody(subject: string | undefined, text: string | undefined): string {
  const subj = subject?.trim() || "(Sem assunto)";
  const body = text?.trim() || "";
  return body ? `${subj}\n\n${body}` : subj;
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
        lastUid > 0
          ? { uid: `${lastUid + 1}:*` }
          : { since: new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000) };

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

      const batch = sortedUids.slice(0, MAX_MESSAGES_PER_SYNC);

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

        const participantName =
          typeof parsed.from === "object" && parsed.from && !Array.isArray(parsed.from)
            ? (parsed.from as { name?: string }).name?.trim() || fromEmail
            : fromEmail;

        const textBody = extractTextBody(parsed);

        await processChannelInboxInbound({
          organizationId: options.organizationId,
          inboxId: options.inboxId,
          channelType: "EMAIL",
          participantId: fromEmail,
          participantName,
          email: fromEmail,
          body: composeInboundBody(parsed.subject, textBody),
          type: "TEXT",
          externalMessageId: messageId,
          log: options.log,
        });
        processed += 1;
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
