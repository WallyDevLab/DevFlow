"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "@/lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

interface Session {
  accessToken: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  updateProfile: (name: string) => Promise<void>;
  /** Re-reads the signed-in user, e.g. after verifying the email address. */
  reloadUser: () => Promise<void>;
  request: <T>(
    path: string,
    options?: { method?: string; body?: unknown },
  ) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Refresh tokens rotate and reuse revokes the session, so concurrent refreshes
// (e.g. React strict mode running effects twice in dev) must share one request.
let refreshInFlight: Promise<Session | null> | null = null;
function restoreSession(): Promise<Session | null> {
  refreshInFlight ??= api<Session>("/auth/refresh", { method: "POST" })
    .catch(() => null)
    .finally(() => {
      setTimeout(() => (refreshInFlight = null), 1000);
    });
  return refreshInFlight;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const tokenRef = useRef<string | null>(null);
  // Updates the ref synchronously so requests made right after login use the new token.
  const setSession = useCallback((s: Session | null) => {
    tokenRef.current = s?.accessToken ?? null;
    setSessionState(s);
  }, []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    restoreSession().then((s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [setSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      setSession(
        await api<Session>("/auth/login", { body: { email, password } }),
      );
    },
    [setSession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      setSession(
        await api<Session>("/auth/register", {
          body: { name, email, password },
        }),
      );
    },
    [setSession],
  );

  // Authenticated request; on a 401 (expired access token) it refreshes the
  // session once and retries.
  const request = useCallback(
    async <T,>(
      path: string,
      options: { method?: string; body?: unknown } = {},
    ) => {
      try {
        return await api<T>(path, { ...options, token: tokenRef.current });
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        refreshInFlight = null;
        const fresh = await restoreSession();
        setSession(fresh);
        if (!fresh) throw err;
        return api<T>(path, { ...options, token: fresh.accessToken });
      }
    },
    [setSession],
  );

  // Changing the password signs out every other device and returns a fresh
  // session for this one.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setSession(
        await request<Session>("/auth/change-password", {
          body: { currentPassword, newPassword },
        }),
      );
    },
    [request, setSession],
  );

  const reloadUser = useCallback(async () => {
    const user = await request<User>("/auth/me");
    setSessionState((prev) => (prev ? { ...prev, user } : prev));
  }, [request]);

  const updateProfile = useCallback(
    async (name: string) => {
      const user = await request<User>("/auth/me", {
        method: "PATCH",
        body: { name },
      });
      setSessionState((prev) => (prev ? { ...prev, user } : prev));
    },
    [request],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
  }, [setSession]);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      loading,
      login,
      register,
      logout,
      request,
      changePassword,
      updateProfile,
      reloadUser,
    }),
    [
      session,
      loading,
      login,
      register,
      logout,
      request,
      changePassword,
      updateProfile,
      reloadUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
