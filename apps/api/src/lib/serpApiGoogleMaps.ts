const SERP_API_BASE = "https://serpapi.com/search.json";

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
  local_results?: SerpMapsLocalResult[];
  serpapi_pagination?: { next?: string };
  error?: string;
}

export interface GoogleMapsSearchParams {
  apiKey: string;
  q: string;
  location?: string;
  start?: number;
  hl?: string;
  gl?: string;
  googleDomain?: string;
  z?: number;
}

export async function searchGoogleMaps(params: GoogleMapsSearchParams): Promise<SerpMapsSearchResponse> {
  const url = new URL(SERP_API_BASE);
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("q", params.q);
  url.searchParams.set("hl", params.hl ?? "pt");
  url.searchParams.set("gl", params.gl ?? "br");
  url.searchParams.set("google_domain", params.googleDomain ?? "google.com.br");
  if (params.location?.trim()) {
    url.searchParams.set("location", params.location.trim());
    url.searchParams.set("z", String(params.z ?? 14));
  }
  if (params.start != null && params.start > 0) {
    url.searchParams.set("start", String(params.start));
  }

  const res = await fetch(url.toString(), { method: "GET" });
  const data = (await res.json()) as SerpMapsSearchResponse;
  if (!res.ok) {
    const msg = data.error ?? data.search_metadata?.error ?? `SerpApi HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (data.search_metadata?.status === "Error") {
    throw new Error(data.search_metadata.error ?? data.error ?? "SerpApi search failed");
  }
  return data;
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

  const res = await fetch(url.toString(), { method: "GET" });
  const data = (await res.json()) as { place_results?: SerpMapsLocalResult; error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `SerpApi HTTP ${res.status}`);
  }
  return data.place_results ?? null;
}
