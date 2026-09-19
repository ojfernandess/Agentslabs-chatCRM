const OPENAI_API_BASE = "https://api.openai.com/v1";

export class OpenAiAdminApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "OpenAiAdminApiError";
    this.status = status;
    this.body = body;
  }
}

type OpenAiAmount = { value?: string; currency?: string };

type OpenAiCostResult = {
  amount?: OpenAiAmount;
  line_item?: string | null;
  project_id?: string | null;
  api_key_id?: string | null;
};

type OpenAiCostBucket = {
  start_time?: number;
  end_time?: number;
  results?: OpenAiCostResult[];
};

type OpenAiPagedResponse<T> = {
  data?: T[];
  has_more?: boolean;
  next_page?: string | null;
};

type OpenAiUsageResult = {
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  num_model_requests?: number;
  model?: string | null;
  project_id?: string | null;
};

type OpenAiUsageBucket = {
  start_time?: number;
  end_time?: number;
  results?: OpenAiUsageResult[];
};

function sanitizeErrorBody(body: string): string {
  return body.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
}

async function openAiAdminFetch<T>(
  apiKey: string,
  path: string,
  query: Record<string, string | number | undefined>,
  arrayParams: Record<string, string[]> = {},
): Promise<T> {
  const url = new URL(`${OPENAI_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  for (const [key, values] of Object.entries(arrayParams)) {
    for (const value of values) {
      url.searchParams.append(key, value);
    }
  }

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new OpenAiAdminApiError(
      `OpenAI Admin API error (${res.status})`,
      res.status,
      sanitizeErrorBody(text.slice(0, 4000)),
    );
  }

  return JSON.parse(text) as T;
}

export async function fetchOpenAiOrganizationCosts(
  apiKey: string,
  startTime: number,
  endTime?: number,
  groupBy: "line_item" | "project_id" = "line_item",
): Promise<OpenAiCostBucket[]> {
  const query: Record<string, string | number | undefined> = {
    start_time: startTime,
    bucket_width: "1d",
    limit: 180,
  };
  if (endTime != null) query.end_time = endTime;

  return fetchAllCostPages(apiKey, query, { "group_by[]": [groupBy] });
}

async function fetchAllCostPages(
  apiKey: string,
  query: Record<string, string | number | undefined>,
  arrayParams: Record<string, string[]> = {},
): Promise<OpenAiCostBucket[]> {
  const buckets: OpenAiCostBucket[] = [];
  let page: string | null | undefined = undefined;

  for (let i = 0; i < 50; i++) {
    const res: OpenAiPagedResponse<OpenAiCostBucket> = await openAiAdminFetch<
      OpenAiPagedResponse<OpenAiCostBucket>
    >(apiKey, "/organization/costs", {
      ...query,
      page: page ?? undefined,
    }, arrayParams);
    buckets.push(...(res.data ?? []));
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }

  return buckets;
}

async function fetchAllUsagePages(
  apiKey: string,
  path: string,
  query: Record<string, string | number | undefined>,
  arrayParams: Record<string, string[]> = {},
): Promise<OpenAiUsageBucket[]> {
  const buckets: OpenAiUsageBucket[] = [];
  let page: string | null | undefined = undefined;

  for (let i = 0; i < 50; i++) {
    const res: OpenAiPagedResponse<OpenAiUsageBucket> = await openAiAdminFetch<
      OpenAiPagedResponse<OpenAiUsageBucket>
    >(apiKey, path, {
      ...query,
      page: page ?? undefined,
    }, arrayParams);
    buckets.push(...(res.data ?? []));
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }

  return buckets;
}

export async function testOpenAiAdminConnection(apiKey: string): Promise<{ ok: true }> {
  const start = Math.floor(Date.now() / 1000) - 86_400;
  await openAiAdminFetch(apiKey, "/organization/costs", {
    start_time: start,
    bucket_width: "1d",
    limit: 1,
  });
  return { ok: true };
}

export async function fetchOpenAiCompletionsUsage(
  apiKey: string,
  startTime: number,
  endTime?: number,
): Promise<OpenAiUsageBucket[]> {
  const query: Record<string, string | number | undefined> = {
    start_time: startTime,
    bucket_width: "1d",
    limit: 180,
  };
  if (endTime != null) query.end_time = endTime;
  return fetchAllUsagePages(apiKey, "/organization/usage/completions", query, { "group_by[]": ["model"] });
}

export type { OpenAiCostBucket, OpenAiCostResult, OpenAiUsageBucket, OpenAiUsageResult };
