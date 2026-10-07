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

export function sipDiag(tag: string, message: string): void {
  const safe = redactSip(message).replace(/\s+/g, " ").trim().slice(0, 180);
  if (!safe) return;
  const at = new Date().toISOString().slice(11, 19);
  events = [...events, { at, tag, message: safe }].slice(-MAX_EVENTS);
  console.info(`[${tag}] ${safe}`);
  emit();
}

export function sipDiagMessage(direction: "in" | "out", raw: unknown): void {
  if (typeof raw !== "string" || !raw.trim()) return;
  const summary = summarizeSip(direction, raw);
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
