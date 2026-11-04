"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api";

export interface User {
  id: string;
  email: string;
  name: string;
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
  const [session, setSession] = useState<Session | null>(null);
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
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setSession(await api<Session>("/auth/login", { body: { email, password } }));
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      setSession(
        await api<Session>("/auth/register", {
          body: { name, email, password },
        }),
      );
    },
    [],
  );

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      loading,
      login,
      register,
      logout,
    }),
    [session, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
