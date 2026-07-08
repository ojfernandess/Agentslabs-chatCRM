import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
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

function composeInboundBody(subject: string | undefined, text: string | undefined): string {
  const subj = subject?.trim() || "(Sem assunto)";
  const body = text?.trim() || "";
  return body ? `${subj}\n\n${body}` : subj;
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

  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapPort === 993,
    auth: {
      user: creds.imapUser,
      pass: creds.imapPassword,
    },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const searchCriteria =
        lastUid > 0
          ? { uid: `${lastUid + 1}:*` }
          : { since: new Date(Date.now() - INITIAL_SYNC_DAYS * 24 * 60 * 60 * 1000) };

      for await (const msg of client.fetch(searchCriteria, { uid: true, source: true }, { uid: true })) {
        if (processed + skipped >= MAX_MESSAGES_PER_SYNC) break;
        if (!msg.uid) continue;
        maxUid = Math.max(maxUid, msg.uid);

        if (!msg.source) {
          skipped += 1;
          continue;
        }

        const parsed = await simpleParser(msg.source);
        const fromEmail = extractEmailAddress(parsed.from);
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

        await processChannelInboxInbound({
          organizationId: options.organizationId,
          inboxId: options.inboxId,
          channelType: "EMAIL",
          participantId: fromEmail,
          participantName,
          email: fromEmail,
          body: composeInboundBody(parsed.subject, parsed.text ?? parsed.textAsHtml ?? undefined),
          type: "TEXT",
          externalMessageId: messageId,
          log: options.log,
        });
        processed += 1;
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.log.warn({ err, inboxId: options.inboxId }, "IMAP sync failed");
    return { processed, skipped, lastUid: maxUid, error: message.slice(0, 240) };
  }

  return { processed, skipped, lastUid: maxUid };
}
