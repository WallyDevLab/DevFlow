"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.name}
        </h1>
        <button
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Sign out
        </button>
      </div>
      <p className="mt-2 text-muted">
        Signed in as <span className="font-mono">{user.email}</span>. Workspaces
        are coming next.
      </p>
    </main>
  );
}
