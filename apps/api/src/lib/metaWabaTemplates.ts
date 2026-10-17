import { bodyVariableCount } from "./templateVariables.js";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaTemplateButton = {
  type?: string;
  text?: string;
  url?: string;
};

export type MetaTemplateComponent = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: MetaTemplateButton[];
};

export type MetaListedTemplate = {
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: MetaTemplateComponent[];
};

export async function fetchWabaIdFromPhoneNumberId(
  phoneNumberId: string,
  accessToken: string,
): Promise<string | null> {
  const url = `${GRAPH_BASE}/${phoneNumberId}?fields=whatsapp_business_account`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Meta API (phone_number): ${res.status} ${t}`);
  }
  const data = (await res.json()) as {
    whatsapp_business_account?: { id?: string };
    error?: { message?: string };
  };
  const id = data.whatsapp_business_account?.id;
  return id?.trim() ? id : null;
}

function bodyTextFromComponents(components: MetaTemplateComponent[] | undefined): string {
  if (!components?.length) return "";
  const body = components.find(
    (c) => String(c.type ?? "").toUpperCase() === "BODY" && typeof c.text === "string",
  );
  return body?.text ?? "";
}

/**
 * Lista modelos aprovados na WABA (Meta / 360dialog com token Graph).
 */
export async function listApprovedWabaMessageTemplates(
  wabaId: string,
  accessToken: string,
): Promise<MetaListedTemplate[]> {
  const out: MetaListedTemplate[] = [];
  let url: string | null =
    `${GRAPH_BASE}/${wabaId}/message_templates?fields=name,status,language,category,components&limit=100`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Meta API (message_templates): ${res.status} ${t}`);
    }
    const data = (await res.json()) as {
      data?: MetaListedTemplate[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    const chunk = data.data ?? [];
    for (const row of chunk) {
      if (String(row.status ?? "").toUpperCase() === "APPROVED") {
        out.push(row);
      }
    }
    url = data.paging?.next ?? null;
  }

  return out;
}

/** Um modelo pelo nome (todas as línguas), com os componentes aprovados na Meta. */
export async function fetchWabaTemplatesByName(
  wabaId: string,
  accessToken: string,
  name: string,
): Promise<MetaListedTemplate[]> {
  const url = `${GRAPH_BASE}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language,category,components`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Meta API (message_templates): ${res.status} ${t}`);
  }
  const data = (await res.json()) as { data?: MetaListedTemplate[] };
  return (data.data ?? []).filter((row) => String(row.status ?? "").toUpperCase() === "APPROVED");
}

export function metaTemplateToLocalFields(row: MetaListedTemplate): {
  name: string;
  body: string;
  providerTemplateId: string;
  templateLanguage: string;
  bodyVariableCount: number;
  metaCategory: string | null;
  isApproved: boolean;
} {
  const body = bodyTextFromComponents(row.components);
  return {
    name: row.name,
    body: body || `(${row.name})`,
    providerTemplateId: row.name,
    templateLanguage: row.language || "en",
    bodyVariableCount: bodyVariableCount(body),
    metaCategory: row.category ?? null,
    isApproved: true,
  };
}
