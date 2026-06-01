import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { isSuperAdminRole } from "@/lib/authRole";

type RoutePoint = {
  id: string;
  name: string;
  routePointDn: string;
};

type OutboundResult =
  | { ok: true; dialPhone: string; contactId: string | null; conversationId: string | null }
  | { ok: false; message: string };

type ThreeCxVoiceContextValue = {
  ready: boolean;
  routePoints: RoutePoint[];
  canPlaceCalls: boolean;
  activeClientCallId: string | null;
  startOutboundCall: (input: {
    phone: string;
    contactId?: string | null;
    conversationId?: string | null;
    threeCxRoutePointId?: string;
  }) => Promise<OutboundResult>;
};

const ThreeCxVoiceContext = createContext<ThreeCxVoiceContextValue | null>(null);

export function useThreeCxVoiceOptional() {
  return useContext(ThreeCxVoiceContext);
}

export function useThreeCxCanPlaceCalls(): boolean {
  const ctx = useThreeCxVoiceOptional();
  return ctx?.canPlaceCalls ?? false;
}

export function ThreeCxVoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [activeClientCallId, setActiveClientCallId] = useState<string | null>(null);
  const routePointsRef = useRef<RoutePoint[]>([]);

  useEffect(() => {
    if (!user) {
      setRoutePoints([]);
      routePointsRef.current = [];
      setReady(false);
      return;
    }
    if (isSuperAdminRole(user.role) && !user.actingOrganizationId) return;
    if (!(user.organizationFeatures?.threecx_voice ?? false)) {
      setRoutePoints([]);
      routePointsRef.current = [];
      setReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ data: RoutePoint[] }>("/threecx/route-points/available");
        if (cancelled) return;
        const list = res.data ?? [];
        setRoutePoints(list);
        routePointsRef.current = list;
      } catch {
        if (!cancelled) {
          setRoutePoints([]);
          routePointsRef.current = [];
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const startOutboundCall = useCallback(
    async (input: {
      phone: string;
      contactId?: string | null;
      conversationId?: string | null;
      threeCxRoutePointId?: string;
    }): Promise<OutboundResult> => {
      const points = routePointsRef.current;
      const routePointId = input.threeCxRoutePointId ?? points[0]?.id;
      if (!routePointId) return { ok: false, message: "no_route_points" };

      const clientCallId = crypto.randomUUID();
      setActiveClientCallId(clientCallId);
      try {
        const res = await api.post<{
          ok: boolean;
          dialPhone?: string;
          contactId?: string | null;
          conversationId?: string | null;
          message?: string;
        }>("/threecx/calls/outbound/start", {
          clientCallId,
          threeCxRoutePointId: routePointId,
          phone: input.phone,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
        });
        if (!res.ok) {
          return { ok: false, message: res.message ?? "call_failed" };
        }
        window.setTimeout(() => {
          void api
            .post("/threecx/calls/outbound/complete", {
              clientCallId,
              threeCxRoutePointId: routePointId,
              status: "ENDED",
              durationSec: null,
            })
            .catch(() => {});
          setActiveClientCallId(null);
        }, 120_000);
        return {
          ok: true,
          dialPhone: res.dialPhone ?? input.phone,
          contactId: res.contactId ?? null,
          conversationId: res.conversationId ?? null,
        };
      } catch (e) {
        setActiveClientCallId(null);
        const message = e instanceof Error ? e.message : "call_failed";
        return { ok: false, message };
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      ready,
      routePoints,
      canPlaceCalls: routePoints.length > 0,
      activeClientCallId,
      startOutboundCall,
    }),
    [ready, routePoints, activeClientCallId, startOutboundCall],
  );

  return <ThreeCxVoiceContext.Provider value={value}>{children}</ThreeCxVoiceContext.Provider>;
}
