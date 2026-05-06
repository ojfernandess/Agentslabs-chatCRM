import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { LoginResponse } from "@openconduit/shared";

export interface AuthUser {
  id: string;
  name: string;
  displayName?: string | null;
  email: string;
  role: string;
  organizationId?: string | null;
  messageSignature?: string | null;
  showAgentNameInChat?: boolean;
  actingOrganizationId?: string | null;
  actingOrganization?: { id: string; name: string; slug: string } | null;
  superAdminActorId?: string | null;
  superAdminActor?: { id: string; email: string; name: string } | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  applySessionToken: (token: string) => Promise<AuthUser>;
  enterOrganization: (organizationId: string) => Promise<AuthUser>;
  exitOrganization: () => Promise<AuthUser>;
  exitUserImpersonation: () => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "openconduit_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    api.setToken(null);
    setUser(null);
  }, []);

  const applySessionToken = useCallback(async (token: string): Promise<AuthUser> => {
    localStorage.setItem(TOKEN_KEY, token);
    api.setToken(token);
    const me = await api.get<AuthUser>("/auth/me");
    setUser(me);
    return me;
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      return;
    }
    api.setToken(token);
    try {
      const me = await api.get<AuthUser>("/auth/me");
      setUser(me);
    } catch {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }

    api.setToken(token);
    api
      .get<AuthUser>("/auth/me")
      .then(setUser)
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = async (email: string, password: string): Promise<AuthUser> => {
    const response = await api.post<LoginResponse>("/auth/login", { email, password });
    return applySessionToken(response.token);
  };

  const enterOrganization = async (organizationId: string): Promise<AuthUser> => {
    const { token } = await api.post<{ token: string }>(
      `/super/organizations/${organizationId}/enter`,
    );
    return applySessionToken(token);
  };

  const exitOrganization = async (): Promise<AuthUser> => {
    const { token } = await api.post<{ token: string }>("/super/session/exit-organization");
    return applySessionToken(token);
  };

  const exitUserImpersonation = async (): Promise<AuthUser> => {
    const { token } = await api.post<{ token: string }>("/auth/exit-user-impersonation");
    return applySessionToken(token);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refreshUser,
        applySessionToken,
        enterOrganization,
        exitOrganization,
        exitUserImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
