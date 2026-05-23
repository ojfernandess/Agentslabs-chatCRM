const SERP_API_BASE = "https://serpapi.com/search.json";
const SERP_FETCH_TIMEOUT_MS = 90_000;

export interface SerpMapsLocalResult {
  position?: number;
  title?: string;
  place_id?: string;
  data_id?: string;
  data_cid?: string;
  address?: string;
  phone?: string;
  website?: string;
  email?: string;
  rating?: number;
  reviews?: number;
  type?: string;
  types?: string[];
  gps_coordinates?: { latitude?: number; longitude?: number };
  open_state?: string;
  description?: string;
  unclaimed_listing?: boolean;
}

export interface SerpMapsSearchResponse {
  search_metadata?: { status?: string; error?: string };
  search_information?: { local_results_state?: string; query_displayed?: string };
  local_results?: SerpMapsLocalResult[] | SerpMapsLocalResult[][] | SerpMapsLocalResult;
  serpapi_pagination?: { next?: string };
  error?: string;
}

export interface GoogleMapsSearchParams {
  apiKey: string;
  q: string;
  /** SerpApi location origin — omit when city is already in `q`. */
  location?: string;
  start?: number;
  hl?: string;
  gl?: string;
  googleDomain?: string;
  z?: number;
}

export class SerpApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly serpStatus?: string,
  ) {
    super(message);
    this.name = "SerpApiError";
  }
}

function isLocalResult(value: unknown): value is SerpMapsLocalResult {
  return Boolean(value && typeof value === "object" && "title" in (value as Record<string, unknown>));
}

/** SerpApi may return a flat array or grouped arrays depending on layout. */
export function normalizeLocalResults(raw: SerpMapsSearchResponse["local_results"]): SerpMapsLocalResult[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const flat: SerpMapsLocalResult[] = [];
    for (const item of raw) {
      if (Array.isArray(item)) {
        for (const inner of item) {
          if (isLocalResult(inner)) flat.push(inner);
        }
      } else if (isLocalResult(item)) {
        flat.push(item);
      }
    }
    return flat;
  }
  return isLocalResult(raw) ? [raw] : [];
}

async function parseSerpJson(res: Response): Promise<SerpMapsSearchResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text) as SerpMapsSearchResponse;
  } catch {
    throw new SerpApiError(
      text.trim().slice(0, 200) || `Resposta inválida da SerpApi (HTTP ${res.status})`,
      res.status,
    );
  }
}

export async function searchGoogleMaps(params: GoogleMapsSearchParams): Promise<{
  localResults: SerpMapsLocalResult[];
  paginationNext: string | null;
  localResultsState: string | null;
}> {
  const url = new URL(SERP_API_BASE);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("q", params.q);
  url.searchParams.set("hl", params.hl ?? "pt");
  url.searchParams.set("gl", params.gl ?? "br");
  url.searchParams.set("google_domain", params.googleDomain ?? "google.com.br");

  const start = params.start ?? 0;
  url.searchParams.set("start", String(start));

  if (params.location?.trim()) {
    url.searchParams.set("location", params.location.trim());
    url.searchParams.set("z", String(params.z ?? 14));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(SERP_FETCH_TIMEOUT_MS),
  });

  const data = await parseSerpJson(res);
  const serpError = data.error ?? data.search_metadata?.error;
  const serpStatus = data.search_metadata?.status;

  if (!res.ok) {
    throw new SerpApiError(serpError ?? `SerpApi HTTP ${res.status}`, res.status, serpStatus);
  }
  if (serpStatus === "Error") {
    throw new SerpApiError(serpError ?? "SerpApi search failed", res.status, serpStatus);
  }

  const localResults = normalizeLocalResults(data.local_results);
  const state = data.search_information?.local_results_state ?? null;

  return {
    localResults,
    paginationNext: data.serpapi_pagination?.next ?? null,
    localResultsState: state,
  };
}

export async function fetchGoogleMapsPlace(params: {
  apiKey: string;
  placeId: string;
  hl?: string;
}): Promise<SerpMapsLocalResult | null> {
  const url = new URL(SERP_API_BASE);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("place_id", params.placeId);
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("hl", params.hl ?? "pt");

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(SERP_FETCH_TIMEOUT_MS),
  });
  const data = (await parseSerpJson(res)) as { place_results?: SerpMapsLocalResult; error?: string };
  if (!res.ok) {
    throw new SerpApiError(data.error ?? `SerpApi HTTP ${res.status}`, res.status);
  }
  return data.place_results ?? null;
}
