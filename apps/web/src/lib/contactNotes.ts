export type ContactNoteEntry = {
  createdById: string | null;
  headerLine: string;
  body: string;
};

export function parseContactNotes(raw: string | null | undefined): ContactNoteEntry[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const chunks = text.split(/\n\n(?=---\n)/);
  const out: ContactNoteEntry[] = [];
  for (const chunk of chunks) {
    let rest = chunk.trim();
    if (!rest) continue;
    if (rest.startsWith("---\n")) rest = rest.slice(4);
    const lines = rest.split("\n");
    let createdById: string | null = null;
    let i = 0;
    if (lines[i]?.startsWith("@userId:")) {
      createdById = lines[i].slice("@userId:".length).trim() || null;
      i += 1;
    }
    const headerLine = lines[i] ?? "";
    i += 1;
    const body = lines.slice(i).join("\n").trim();
    if (!headerLine && !body) continue;
    out.push({ createdById, headerLine, body });
  }
  return out;
}

export function serializeContactNotes(entries: ContactNoteEntry[]): string {
  return entries
    .map((entry) => {
      const lines = ["---"];
      if (entry.createdById) lines.push(`@userId:${entry.createdById}`);
      if (entry.headerLine) lines.push(entry.headerLine);
      if (entry.body) lines.push(entry.body);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function buildNewContactNoteEntry(input: {
  userId: string;
  when: string;
  who: string;
  text: string;
}): ContactNoteEntry {
  return {
    createdById: input.userId,
    headerLine: `${input.when} · ${input.who}`,
    body: input.text.trim(),
  };
}
