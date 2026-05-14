function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export type EvolutionGoInstanceInfo = {
  id: string;
  name: string;
  connected: boolean;
};

export async function evolutionGoFetchAllInstances(options: {
  baseUrl: string;
  apiKey: string;
}): Promise<EvolutionGoInstanceInfo[] | null> {
  const base = normalizeBaseUrl(options.baseUrl);
  const res = await fetch(`${base}/instance/all`, {
    headers: {
      apikey: options.apiKey,
    },
  });
  if (!res.ok) return null;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const root = asRecord(json);
  const data = root ? root.data : null;
  if (!Array.isArray(data)) return null;
  const out: EvolutionGoInstanceInfo[] = [];
  for (const row of data) {
    const r = asRecord(row);
    if (!r) continue;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const connected = r.connected === true;
    if (!id || !name) continue;
    out.push({ id, name, connected });
  }
  return out;
}

export async function evolutionGoConnectInstance(options: {
  baseUrl: string;
  apiKey: string;
  instanceId: string;
  webhookUrl: string;
  subscribe: string[];
  immediate: boolean;
  phone?: string;
}): Promise<boolean> {
  const base = normalizeBaseUrl(options.baseUrl);
  const res = await fetch(`${base}/instance/connect`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      instanceId: options.instanceId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      webhookUrl: options.webhookUrl,
      subscribe: options.subscribe,
      immediate: options.immediate,
      ...(options.phone ? { phone: options.phone } : {}),
    }),
  });
  return res.ok;
}

