import JsSIP from "jssip";

const grammar = JsSIP.Grammar as { parse: (input: string, rule: string) => unknown };

const HEADER_RULE: Record<string, string> = {
  from: "From",
  f: "From",
  to: "To",
  t: "To",
  contact: "Contact",
  m: "Contact",
  "record-route": "Record_Route",
  via: "Via",
  v: "Via",
  "call-id": "Call_ID",
  i: "Call_ID",
  cseq: "CSeq",
  "content-length": "Content_Length",
  l: "Content_Length",
  "content-type": "Content_Type",
  c: "Content_Type",
  "max-forwards": "Max_Forwards",
  "session-expires": "Session_Expires",
  x: "Session_Expires",
  "refer-to": "Refer_To",
  r: "Refer_To",
  replaces: "Replaces",
  event: "Event",
  o: "Event",
  "www-authenticate": "WWW_Authenticate",
  "proxy-authenticate": "Proxy_Authenticate",
};

const DROP_IF_BROKEN = new Set([
  "record-route",
  "session-expires",
  "x",
  "refer-to",
  "r",
  "replaces",
  "event",
  "o",
  "www-authenticate",
  "proxy-authenticate",
]);

const REWRITE_IF_BROKEN = new Set(["from", "f", "to", "t", "contact", "m"]);

function headerParses(value: string, rule: string): boolean {
  try {
    return grammar.parse(value, rule) !== -1;
  } catch {
    return false;
  }
}

function sipUri(value: string): string | null {
  const match = value.match(/sips?:[^>\s;]+/i);
  return match?.[0] ?? null;
}

function rewriteNameAddr(name: string, value: string): string | null {
  const uri = sipUri(value);
  if (!uri) return null;
  const tag = value.match(/;\s*tag=([^;\s]+)/i)?.[1];
  const next = tag ? `<${uri}>;tag=${tag}` : `<${uri}>`;
  return headerParses(next, HEADER_RULE[name.toLowerCase()] ?? "From") ? `${name}: ${next}` : null;
}

function retargetInvite(message: string, sipUser: string): { message: string; changed: boolean } {
  const user = sipUser.trim();
  if (!user) return { message, changed: false };
  const lineEnd = message.indexOf("\r\n");
  const line = lineEnd === -1 ? message : message.slice(0, lineEnd);
  const match = line.match(/^INVITE\s+sip:([^@;\s>]+)@/i);
  if (!match || match[1] === user) return { message, changed: false };
  const next = line.replace(/^(INVITE\s+sip:)[^@;\s>]+/i, `$1${user}`);
  return { message: next + (lineEnd === -1 ? "" : message.slice(lineEnd)), changed: true };
}

/** Deixa um INVITE num formato que o JsSIP consegue aceitar. */
export function repairInvite(message: string, sipUser: string): { message: string; note: string } {
  if (!/^INVITE\s/i.test(message)) return { message, note: "" };
  const notes: string[] = [];
  const retargeted = retargetInvite(message, sipUser);
  if (retargeted.changed) notes.push("user");
  const sep = retargeted.message.indexOf("\r\n\r\n");
  if (sep === -1) return { message: retargeted.message, note: notes.join(",") };

  const unfolded: string[] = [];
  for (const line of retargeted.message.slice(0, sep).split("\r\n")) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else unfolded.push(line);
  }

  const out: string[] = [];
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon <= 0 || out.length === 0) {
      out.push(line);
      continue;
    }
    const name = line.slice(0, colon).trim();
    const lower = name.toLowerCase();
    const rule = HEADER_RULE[lower];
    const value = line.slice(colon + 1).trim().replace(/\u00a0/g, "");
    const cleanLine = `${name}: ${value}`;
    if ((lower === "content-type" || lower === "c") && value.toLowerCase().startsWith("application/sdp")) {
      if (value.toLowerCase() !== "application/sdp") notes.push(name);
      out.push(`${name}: application/sdp`);
      continue;
    }
    if (!rule || headerParses(value, rule)) {
      out.push(cleanLine);
      continue;
    }
    notes.push(name);
    if (lower === "via" || lower === "v") {
      const branch = value.match(/branch=([^;\s]+)/i)?.[1] ?? "z9hG4bKopenconduit";
      const sentBy = value.match(/SIP\/2\.0\/\S+\s+([^;\s]+)/i)?.[1] ?? "invalid.invalid";
      const via = `SIP/2.0/WSS ${sentBy};branch=${branch}`;
      out.push(`${name}: ${headerParses(via, "Via") ? via : "SIP/2.0/WSS invalid.invalid;branch=z9hG4bKopenconduit"}`);
      continue;
    }
    if (REWRITE_IF_BROKEN.has(lower)) {
      const tag = value.match(/;\s*tag=([^;\s]+)/i)?.[1];
      const rewritten =
        rewriteNameAddr(name, value) ??
        `${name}: <sip:anonymous@anonymous.invalid>${lower === "contact" || lower === "m" || !tag ? "" : `;tag=${tag}`}`;
      out.push(rewritten);
      continue;
    }
  }

  const first = out[0] ?? "";
  if (!headerParses(first, "Request_Line")) {
    const user = sipUser.trim() || first.match(/^INVITE\s+sip:([^@;\s>]+)@/i)?.[1] || "user";
    const host = first.match(/@([^;:\s>]+)/i)?.[1] || "invalid.invalid";
    out[0] = `INVITE sip:${user}@${host} SIP/2.0`;
    notes.push("line");
  }

  return { message: `${out.join("\r\n")}${retargeted.message.slice(sep)}`, note: notes.join(",") };
}

/** Primeiro trecho do INVITE que o JsSIP ainda recusaria. */
export function inviteFault(message: string): string {
  const sep = message.indexOf("\r\n\r\n");
  const head = sep === -1 ? message : message.slice(0, sep);
  const lines = head.split("\r\n").filter(Boolean);
  const first = lines[0] ?? "";
  if (!headerParses(first, "Request_Line")) return "line";
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) return "header";
    const name = line.slice(0, colon).trim();
    const rule = HEADER_RULE[name.toLowerCase()];
    if (!rule) continue;
    if (!headerParses(line.slice(colon + 1).trim(), rule)) return name;
  }
  return "";
}
