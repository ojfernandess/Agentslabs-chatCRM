import { useSyncExternalStore } from "react";

export type SipDiagEvent = { at: string; tag: string; message: string };

const MAX_EVENTS = 40;
let events: SipDiagEvent[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function maskSipUser(user: string): string {
  const value = user.trim();
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

export function redactSip(message: string): string {
  return message
    .replace(/^(Authorization:).*$/gim, "$1 [redacted]")
    .replace(/^(Proxy-Authorization:).*$/gim, "$1 [redacted]")
    .replace(/^(WWW-Authenticate:).*$/gim, "$1 [redacted]")
    .replace(/^(Proxy-Authenticate:).*$/gim, "$1 [redacted]")
    .replace(/(sip:)([^@;\s>]+)/gi, (_match, prefix: string, user: string) => `${prefix}${maskSipUser(user)}`)
    .replace(/(response=")[^"]*/gi, '$1[redacted]')
    .replace(/\b(password|token|secret|napikey)[=:]\s*\S+/gi, "$1=[redacted]");
}

export function summarizeSip(direction: "in" | "out", raw: string): string | null {
  const text = redactSip(String(raw));
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines[0] ?? "";
  if (!start || start === "\\r\\n" || start === "") return null;
  const cseq = lines.find((line) => /^CSeq:/i.test(line)) ?? "";
  const method = cseq.split(/\s+/)[2] ?? "";
  if (/^SIP\/2\.0\s+(\d+)/i.test(start)) {
    const code = start.replace(/^SIP\/2\.0\s+/i, "").slice(0, 32);
    return method ? `${method} → ${code}` : code;
  }
  if (/^(REGISTER|INVITE|ACK|BYE|CANCEL|OPTIONS|UPDATE)\s/i.test(start)) {
    const verb = start.split(/\s+/)[0]?.toUpperCase() ?? "SIP";
    return direction === "in" ? `Incoming ${verb}` : `Sending ${verb}`;
  }
  return null;
}

export function sipClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function sipDiag(tag: string, message: string): void {
  const safe = redactSip(message).replace(/\s+/g, " ").trim().slice(0, 180);
  if (!safe) return;
  const at = sipClock(new Date());
  events = [...events, { at, tag, message: safe }].slice(-MAX_EVENTS);
  console.info(`[${tag}] ${safe}`);
  emit();
}

export function decodeSipPayload(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (ArrayBuffer.isView(raw)) {
    const view = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return new TextDecoder().decode(view);
  }
  return "";
}

/** Separa um quadro WebSocket em mensagens SIP completas. */
export function sipFrames(raw: unknown): string[] {
  let text = decodeSipPayload(raw).replace(/^\uFEFF/, "");
  if (!text.trim()) return [];
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\n+/, "").replace(/\n/g, "\r\n");
  const stripped = text.replace(/^(?:\r\n)+/, "");
  if (!stripped) return [text];

  const frames: string[] = [];
  let rest = stripped;
  while (rest.length > 0) {
    rest = rest.replace(/^(?:\r\n)+/, "");
    if (!rest) break;
    const sep = rest.indexOf("\r\n\r\n");
    if (sep === -1) {
      frames.push(rest);
      break;
    }
    const headers = rest.slice(0, sep);
    const match = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(headers);
    if (!match) {
      frames.push(rest);
      break;
    }
    const length = Number(match[1]);
    const end = sep + 4 + (Number.isFinite(length) ? length : 0);
    if (end > rest.length) {
      frames.push(rest);
      break;
    }
    frames.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return frames;
}

export function sipDiagMessage(direction: "in" | "out", raw: unknown): void {
  const text = typeof raw === "string" ? raw : decodeSipPayload(raw);
  if (!text.trim()) return;
  const summary = summarizeSip(direction, text);
  if (!summary) return;
  sipDiag("SIP", summary);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSipDiagnostics(): SipDiagEvent[] {
  return useSyncExternalStore(subscribe, () => events, () => events);
}
