import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  type BroadcastCampaignAnalytics,
  type CampaignAnalyticsFilters,
  DEFAULT_ANALYTICS_FILTERS,
  defaultAnalyticsDateInputs,
} from "./types";

function buildQueryParams(filters: CampaignAnalyticsFilters): URLSearchParams {
  const params = new URLSearchParams();
  const dates = defaultAnalyticsDateInputs();
  const from = filters.from || dates.from;
  const to = filters.to || dates.to;
  params.set("from", new Date(`${from}T00:00:00`).toISOString());
  params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
  params.set("campaignKind", filters.campaignKind);
  params.set("status", filters.status);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return params;
}

export function useCampaignAnalytics() {
  const initialDates = defaultAnalyticsDateInputs();
  const [filters, setFilters] = useState<CampaignAnalyticsFilters>({
    ...DEFAULT_ANALYTICS_FILTERS,
    from: initialDates.from,
    to: initialDates.to,
  });
  const [data, setData] = useState<BroadcastCampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (activeFilters: CampaignAnalyticsFilters) => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQueryParams(activeFilters).toString();
      const res = await api.get<BroadcastCampaignAnalytics>(`/broadcasts/analytics?${qs}`);
      setData(res);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to load analytics";
      setError(msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void load(filters);
    }, filters.search ? 400 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, load]);

  const patchFilters = useCallback((patch: Partial<CampaignAnalyticsFilters>) => {
    setFilters((prev) => {
      const resetsPage =
        patch.page === undefined &&
        (patch.search !== undefined ||
          patch.status !== undefined ||
          patch.channel !== undefined ||
          patch.campaignKind !== undefined ||
          patch.from !== undefined ||
          patch.to !== undefined);
      return {
        ...prev,
        ...patch,
        page: patch.page ?? (resetsPage ? 1 : prev.page),
      };
    });
  }, []);

  const exportCsv = useCallback(async () => {
    setExportBusy(true);
    try {
      const params = buildQueryParams({ ...filters, page: 1, pageSize: 200 });
      params.set("pageSize", "200");
      const blob = await api.fetchBlob(`/broadcasts/analytics/export?${params.toString()}&format=csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campaign-analytics-${filters.to || defaultAnalyticsDateInputs().to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }, [filters]);

  return {
    filters,
    patchFilters,
    data,
    loading,
    error,
    reload: () => load(filters),
    exportCsv,
    exportBusy,
  };
}
